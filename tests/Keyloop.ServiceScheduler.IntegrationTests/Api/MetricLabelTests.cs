using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class MetricLabelTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Guid Site => ReferenceDataSeed.ReadingDealershipId;
    private static DateTime Start => TestData.LondonTime(10);

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Booking_validation_lock_wait_and_availability_emit_no_dealership_metric_label()
    {
        var spans = new ConcurrentQueue<Activity>();
        using var listener = Listen(spans);
        using var metrics = new MetricsCollector();
        using var client = _factory.CreateClient();
        var service = ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE");
        using var booked = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments",
            TestData.BookingRequest(service, Start), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        using var invalid = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments",
            TestData.BookingRequest(service, Start.AddSeconds(1)), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        invalid.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var available = await client.GetAsync($"/api/v1/dealerships/{Site}/availability?serviceTypeId={service}&date=2026-10-13", Ct);
        available.StatusCode.ShouldBe(HttpStatusCode.OK);
        metrics.Of("scheduler.booking.requests").Count.ShouldBe(2);
        metrics.Of("scheduler.booking.requests").ShouldAllBe(m => m.Tags.Select(t => t.Key).SequenceEqual(new[] { "outcome" }));
        metrics.Of("scheduler.booking.lock_wait").ShouldHaveSingleItem().Tags.ShouldBeEmpty();
        metrics.Of("scheduler.availability.duration").ShouldHaveSingleItem().Tags.ShouldBeEmpty();
        var wait = spans.Single(a => a.OperationName == "scheduler.acquire_dealership_lock");
        wait.GetTagItem("dealership.id").ShouldBe(Site.ToString());
        wait.GetTagItem("lock.wait_ms").ShouldBeOfType<double>().ShouldBeGreaterThanOrEqualTo(0);
        spans.Single(a => a.OperationName == "scheduler.book_appointment").GetTagItem("dealership.id").ShouldBe(Site.ToString());
    }

    [Fact]
    public async Task Custom_policy_codes_share_one_metric_label_and_keep_their_trace_and_allocation_evidence()
    {
        await _factory.WithDbAsync(async db =>
        {
            var routine = await db.RequirementRules.AsNoTracking().SingleAsync(r => r.DealershipId == Site && r.Code == "hv-routine", Ct);
            db.RequirementRules.AddRange(routine with { Id = Guid.NewGuid(), Code = "site-custom-one" },
                routine with { Id = Guid.NewGuid(), Code = "site-custom-two" });
            await db.SaveChangesAsync(Ct);
        });
        var spans = new ConcurrentQueue<Activity>();
        using var listener = Listen(spans);
        using var metrics = new MetricsCollector();
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        using var booked = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments",
            TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), Start), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created, await booked.Content.ReadAsStringAsync(Ct));
        var response = await booked.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        response.Allocation.ShouldNotBeNull().FiredRules.ShouldContain("site-custom-one");
        response.Allocation.FiredRules.ShouldContain("site-custom-two");
        metrics.Sum("scheduler.requirements.rule_fired", MetricsCollector.Tag("rule", "custom")).ShouldBe(2);
        metrics.Of("scheduler.requirements.rule_fired").ShouldAllBe(m => m.Tag("rule")!.ToString()!.StartsWith("site-", StringComparison.Ordinal) == false);
        spans.Single(a => a.OperationName == "scheduler.book_appointment").GetTagItem("requirements.fired_rules")
            .ShouldBeOfType<string[]>().ShouldContain("site-custom-one");
    }

    private static ActivityListener Listen(ConcurrentQueue<Activity> spans)
    {
        var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == SchedulerTelemetry.Name,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = spans.Enqueue,
        };
        ActivitySource.AddActivityListener(listener);
        return listener;
    }
}

using System.Data.Common;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Concurrency;

/// <summary>Separate from the unchanged ten-case 30-way ADR-003 proof.</summary>
public sealed class AdminBookingInteractionTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Guid Site => ReferenceDataSeed.ReadingDealershipId;
    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }
    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData("technician", "technician-inactive")]
    [InlineData("hv-level", "technician-hv-level-lowered")]
    [InlineData("certification", "technician-certification-removed")]
    [InlineData("bay", "bay-inactive")]
    [InlineData("capability", "bay-capability-removed")]
    [InlineData("policy", null)]
    public async Task Edit_during_in_flight_booking_preserves_snapshot_and_read_flags_current_lapses(string edit, string? reason)
    {
        using var metrics = new MetricsCollector();
        var pause = new BeforeBookingLock();
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, o) => o.AddInterceptors(pause))));
        using var bookingClient = host.CreateClient();
        using var admin = host.CreateClient();
        var technicianId = ReferenceDataSeed.TechnicianId("T-1001");
        var bayId = ReferenceDataSeed.BayId("reading", 1);
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10),
            preferredBayId: bayId, preferredTechnicianId: technicianId);
        var path = $"/api/v1/dealerships/{Site}/" + (edit == "policy" ? "requirement-policy"
            : edit is "bay" or "capability" ? $"bays/{bayId}" : $"technicians/{technicianId}");
        using var read = await admin.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        pause.Arm();
        var booking = bookingClient.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        try
        {
            // All resource and policy reads have completed before this first transaction command can run.
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            booking.IsCompleted.ShouldBeFalse();
            switch (edit)
            {
                case "technician": case "bay": body["isActive"] = false; break;
                case "hv-level": body["hvLevel"] = 1; break;
                case "certification": body["certifications"] = new JsonArray(); break;
                case "capability": body["capabilities"] = new JsonArray(); break;
                case "policy":
                    body["rules"]![1]!["minimumHvLevel"] = 4;
                    body["previewDate"] = "2026-10-13";
        body["dryRun"] ??= JsonValue.Create(false);
                    break;
            }
            using var message = new HttpRequestMessage(HttpMethod.Put, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
            message.Headers.TryAddWithoutValidation("If-Match", read.Headers.ETag!.ToString());
            using var edited = await admin.SendAsync(message, Ct).WaitAsync(TimeSpan.FromSeconds(20), Ct);
            edited.StatusCode.ShouldBe(HttpStatusCode.OK, await edited.Content.ReadAsStringAsync(Ct));
            booking.IsCompleted.ShouldBeFalse("the edit must complete while the booking is in flight");
        }
        finally { pause.Release.TrySetResult(); }
        using var completed = await booking.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.Created, await completed.Content.ReadAsStringAsync(Ct));
        var appointment = await completed.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Technician.Id.ShouldBe(technicianId);
        appointment.Bay.Id.ShouldBe(bayId);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(2);
        appointment.Allocation.MinimumHvLevel.ShouldBe(2);
        using var details = await admin.GetAsync($"/api/v1/appointments/{appointment.Id}", Ct);
        var warning = JsonNode.Parse(await details.Content.ReadAsStringAsync(Ct))!["competenceWarning"];
        if (reason is null) { warning.ShouldBeNull(); }
        else
        {
            warning.ShouldNotBeNull()["requiresReview"]!.GetValue<bool>().ShouldBeTrue();
            warning["reasonCodes"]!.AsArray().Select(r => r!.GetValue<string>()).ShouldBe([reason]);
        }
        var recorded = await _factory.WithDbAsync(db => db.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointment.Id, Ct));
        recorded.RecordedRequirements.ShouldNotBeNull().MinimumHvLevel.ShouldBe(2);
        metrics.Sum("scheduler.allocation.below_hv_minimum").ShouldBe(0);
        metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0);
        metrics.Sum("scheduler.admin.edits").ShouldBe(1);
        metrics.Of("scheduler.admin.edits").ShouldAllBe(m => m.Tags.Select(t => t.Key).Order().SequenceEqual(new[] { "action", "resource" }));
        // New snapshots see the edit. A strict policy leaves level-4 routine maintenance honestly unbookable.
        if (edit == "policy")
        {
            using var fresh = await admin.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments",
                request with { StartUtc = TestData.LondonTime(12) }, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
            fresh.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        }
    }

    private sealed class BeforeBookingLock : DbCommandInterceptor
    {
        private int _armed;
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Arm() => Interlocked.Exchange(ref _armed, 1);
        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("pg_advisory_xact_lock", StringComparison.Ordinal) && command.Parameters.Count == 1
                && Interlocked.Exchange(ref _armed, 0) == 1)
            {
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
            return result;
        }
    }
}

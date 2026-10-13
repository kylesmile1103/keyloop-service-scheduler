using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Concurrency;

public sealed class PolicyChurnTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private readonly CapturingLoggerProvider _logs = new();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Guid Site => ReferenceDataSeed.ReadingDealershipId;
    private static string PolicyPath => $"/api/v1/dealerships/{Site}/requirement-policy";

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock(), _logs);
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Repeated_policy_publications_return_retryable_409_and_same_key_can_book_after_churn_stops()
    {
        using var adminHost = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var admin = adminHost.CreateClient();
        var churn = new PublishBeforeLock(() => PublishAsync(admin));
        using var bookingHost = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, o) => o.AddInterceptors(churn))));
        using var client = bookingHost.CreateClient();
        var spans = new ConcurrentQueue<Activity>();
        using var activities = new ActivityListener
        {
            ShouldListenTo = source => source.Name == SchedulerTelemetry.Name,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = spans.Enqueue,
        };
        ActivitySource.AddActivityListener(activities);
        using var metrics = new MetricsCollector();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10));
        var headers = new Dictionary<string, string> { ["Idempotency-Key"] = Guid.NewGuid().ToString() };
        var path = $"/api/v1/dealerships/{Site}/appointments";
        using var refused = await client.PostJsonAsync(path, request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct)
            .WaitAsync(TimeSpan.FromSeconds(30), Ct);

        var problem = await refused.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency-conflict", Ct);
        problem.GetProperty("detail").GetString().ShouldBe(
            "The requirement policy changed repeatedly while this booking was being prepared. Refresh availability and retry the booking.");
        refused.Headers.RetryAfter.ShouldBeNull();
        churn.Publications.ShouldBe(4, "three re-resolutions are allowed before a fourth mismatch ends this request");
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(0);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(0);
            (await db.NotificationOutbox.CountAsync(Ct)).ShouldBe(0);
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0);
            (await db.AdminChanges.CountAsync(Ct)).ShouldBe(4);
        });
        metrics.Of("scheduler.booking.requests").ShouldHaveSingleItem().Tag("outcome").ShouldBe("concurrency_conflict");
        metrics.Of("scheduler.booking.duration").ShouldHaveSingleItem().Tag("outcome").ShouldBe("concurrency_conflict");
        spans.Single(a => a.OperationName == "scheduler.book_appointment").GetTagItem("booking.outcome").ShouldBe("concurrency_conflict");
        _logs.Entries.ShouldContain(e => e.EventId.Id == 1002 && e.Message.Contains("concurrency_conflict", StringComparison.Ordinal));
        _logs.Entries.ShouldNotContain(e => e.EventId.Id == 1200);

        using var retried = await client.PostJsonAsync(path, request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        retried.StatusCode.ShouldBe(HttpStatusCode.Created, await retried.Content.ReadAsStringAsync(Ct));
        var appointment = await retried.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(6);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(1);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
            (await db.NotificationOutbox.CountAsync(Ct)).ShouldBe(1);
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(1);
        });
    }

    private static async Task PublishAsync(HttpClient admin)
    {
        using var read = await admin.GetAsync(PolicyPath, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        var etag = read.Headers.ETag!.ToString();
        body["previewDate"] = "2026-10-13";
        body["dryRun"] = true;
        using var preview = await PutAsync(admin, body, etag);
        preview.StatusCode.ShouldBe(HttpStatusCode.OK);
        body["previewToken"] = JsonNode.Parse(await preview.Content.ReadAsStringAsync(Ct))!["previewToken"]!.GetValue<string>();
        body["dryRun"] = false;
        using var publication = await PutAsync(admin, body, etag);
        publication.StatusCode.ShouldBe(HttpStatusCode.OK, await publication.Content.ReadAsStringAsync(Ct));
    }

    private static async Task<HttpResponseMessage> PutAsync(HttpClient client, JsonNode body, string etag)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, PolicyPath)
            { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("If-Match", etag);
        return await client.SendAsync(request, Ct);
    }

    private sealed class PublishBeforeLock(Func<Task> publish) : DbCommandInterceptor
    {
        public int Publications { get; private set; }

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Publications < 4 && command.CommandText.Contains("pg_advisory_xact_lock", StringComparison.Ordinal)
                && command.Parameters.Count == 1)
            {
                await publish().WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
                Publications++;
            }
            return result;
        }
    }
}

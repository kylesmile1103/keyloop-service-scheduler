using System.Data.Common;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Concurrency;

/// <summary>
/// Admin edits against a real booking in flight (ADR-029 Task 30a amendment). Separate from the unchanged ten-case 30-way ADR-003 proof.
/// Resource edits accept the booking's earlier roster snapshot and are flagged on read; a policy publication takes the dealership lock
/// to commit, so a booking re-resolves under its lock instead of committing under a superseded version.
/// </summary>
public sealed class AdminBookingInteractionTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Guid Site => ReferenceDataSeed.ReadingDealershipId;
    private static string PolicyPath => $"/api/v1/dealerships/{Site}/requirement-policy";
    private static Guid TechnicianId => ReferenceDataSeed.TechnicianId("T-1001");
    private static Guid BayId => ReferenceDataSeed.BayId("reading", 1);

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
    public async Task Resource_edit_during_in_flight_booking_preserves_snapshot_and_read_flags_the_lapse(string edit, string reason)
    {
        using var metrics = new MetricsCollector();
        var pause = new BookingLockPause(afterAcquired: false);
        using var host = Host(pause);
        using var bookingClient = host.CreateClient();
        using var admin = host.CreateClient();
        var path = $"/api/v1/dealerships/{Site}/" + (edit is "bay" or "capability" ? $"bays/{BayId}" : $"technicians/{TechnicianId}");
        using var read = await admin.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        pause.Arm();
        var booking = bookingClient.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", Request(10), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        try
        {
            // All resource and policy reads have completed before the booking's lock command can run.
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            booking.IsCompleted.ShouldBeFalse();
            switch (edit)
            {
                case "technician": case "bay": body["isActive"] = false; break;
                case "hv-level": body["hvLevel"] = 1; break;
                case "certification": body["certifications"] = new JsonArray(); break;
                case "capability": body["capabilities"] = new JsonArray(); break;
            }
            using var edited = await PutAsync(admin, path, body, read.Headers.ETag!.ToString()).WaitAsync(TimeSpan.FromSeconds(20), Ct);
            edited.StatusCode.ShouldBe(HttpStatusCode.OK, await edited.Content.ReadAsStringAsync(Ct));
            booking.IsCompleted.ShouldBeFalse("the edit must complete while the booking is in flight");
        }
        finally { pause.Release.TrySetResult(); }
        using var completed = await booking.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.Created, await completed.Content.ReadAsStringAsync(Ct));
        var appointment = await completed.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Technician.Id.ShouldBe(TechnicianId);
        appointment.Bay.Id.ShouldBe(BayId);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(2);
        appointment.Allocation.MinimumHvLevel.ShouldBe(2);
        (await WarningCodesAsync(admin, appointment.Id)).ShouldBe([reason]);
        var recorded = await _factory.WithDbAsync(db => db.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointment.Id, Ct));
        recorded.RecordedRequirements.ShouldNotBeNull().MinimumHvLevel.ShouldBe(2);
        metrics.Sum("scheduler.allocation.below_hv_minimum").ShouldBe(0);
        metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0);
        metrics.Sum("scheduler.admin.edits").ShouldBe(1);
        metrics.Of("scheduler.admin.edits").ShouldAllBe(m => m.Tags.Select(t => t.Key).Order().SequenceEqual(new[] { "action", "resource" }));
    }

    /// <summary>
    /// A safety-motivated HV increase published while a booking waits for its lock is never undercut: the publication commits under the
    /// dealership lock, the booking finds the newer version under its own lock and re-resolves, and level-4 routine work is refused.
    /// </summary>
    [Fact]
    public async Task Stricter_policy_published_while_a_booking_waits_for_its_lock_is_enforced_by_revalidation()
    {
        using var metrics = new MetricsCollector();
        var pause = new BookingLockPause(afterAcquired: false);
        using var host = Host(pause);
        using var bookingClient = host.CreateClient();
        using var admin = host.CreateClient();
        using var read = await admin.GetAsync(PolicyPath, Ct);
        var policy = Publication(JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!, rule: 1, minimumHvLevel: 4);
        pause.Arm();
        var booking = bookingClient.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", Request(10), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        try
        {
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            using var published = await PutAsync(admin, PolicyPath, policy, read.Headers.ETag!.ToString()).WaitAsync(TimeSpan.FromSeconds(20), Ct);
            published.StatusCode.ShouldBe(HttpStatusCode.OK, await published.Content.ReadAsStringAsync(Ct));
            booking.IsCompleted.ShouldBeFalse("the publication must commit while the booking is in flight");
        }
        finally { pause.Release.TrySetResult(); }
        using var refused = await booking.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        var problem = await refused.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct);
        problem.GetProperty("minimumHvLevel").GetInt32().ShouldBe(4);
        (await _factory.WithDbAsync(db => db.Appointments.CountAsync(Ct))).ShouldBe(0);
        metrics.Sum("scheduler.allocation.below_hv_minimum").ShouldBe(0);
        metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0);
        metrics.Sum("scheduler.admin.edits").ShouldBe(1);
    }

    /// <summary>A publication that leaves the booking qualified is not a refusal: the booking re-resolves and records the newer version.</summary>
    [Fact]
    public async Task Policy_published_while_a_booking_waits_for_its_lock_is_re_resolved_and_recorded()
    {
        var pause = new BookingLockPause(afterAcquired: false);
        using var host = Host(pause);
        using var bookingClient = host.CreateClient();
        using var admin = host.CreateClient();
        using var read = await admin.GetAsync(PolicyPath, Ct);
        // hv-awareness (wheel alignment and MOT) only: interim service still needs level 2.
        var policy = Publication(JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!, rule: 0, minimumHvLevel: 2);
        pause.Arm();
        var booking = bookingClient.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", Request(10), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        try
        {
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            using var published = await PutAsync(admin, PolicyPath, policy, read.Headers.ETag!.ToString()).WaitAsync(TimeSpan.FromSeconds(20), Ct);
            published.StatusCode.ShouldBe(HttpStatusCode.OK, await published.Content.ReadAsStringAsync(Ct));
        }
        finally { pause.Release.TrySetResult(); }
        using var completed = await booking.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.Created, await completed.Content.ReadAsStringAsync(Ct));
        var appointment = await completed.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(3);
        appointment.Allocation.MinimumHvLevel.ShouldBe(2);
        (await WarningCodesAsync(admin, appointment.Id)).ShouldBeEmpty();
    }

    /// <summary>
    /// The other order: a booking that already holds the dealership lock commits under the version it resolved, and the publication waits
    /// for it (seeding lock, then dealership lock: the reseed's existing order). That appointment predates the new version and keeps its own.
    /// </summary>
    [Fact]
    public async Task Policy_publication_waits_for_a_booking_holding_the_dealership_lock()
    {
        var pause = new BookingLockPause(afterAcquired: true);
        using var host = Host(pause);
        using var bookingClient = host.CreateClient();
        using var admin = host.CreateClient();
        using var read = await admin.GetAsync(PolicyPath, Ct);
        var policy = Publication(JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!, rule: 1, minimumHvLevel: 4);
        pause.Arm();
        var booking = bookingClient.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", Request(10), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        Task<HttpResponseMessage>? publication = null;
        try
        {
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            publication = PutAsync(admin, PolicyPath, policy, read.Headers.ETag!.ToString());
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            publication.IsCompleted.ShouldBeFalse("the publication must wait for the booking that holds the dealership lock");
        }
        finally { pause.Release.TrySetResult(); }
        using var completed = await booking.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        completed.StatusCode.ShouldBe(HttpStatusCode.Created, await completed.Content.ReadAsStringAsync(Ct));
        using var published = await publication!.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        published.StatusCode.ShouldBe(HttpStatusCode.OK, await published.Content.ReadAsStringAsync(Ct));
        JsonNode.Parse(await published.Content.ReadAsStringAsync(Ct))!["policy"]!["version"]!.GetValue<int>().ShouldBe(3);
        var appointment = await completed.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(2);
        (await WarningCodesAsync(admin, appointment.Id)).ShouldBeEmpty();
        using var fresh = await admin.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", Request(12), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        fresh.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    private WebApplicationFactory<Program> Host(BookingLockPause pause) =>
        _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, o) => o.AddInterceptors(pause))));

    private static BookAppointmentRequest Request(int hour) =>
        TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(hour),
            preferredBayId: BayId, preferredTechnicianId: TechnicianId);

    private static JsonNode Publication(JsonNode policy, int rule, int minimumHvLevel)
    {
        policy["rules"]![rule]!["minimumHvLevel"] = minimumHvLevel;
        policy["previewDate"] = "2026-10-13";
        policy["dryRun"] = false;
        return policy;
    }

    private static async Task<string[]> WarningCodesAsync(HttpClient client, Guid appointmentId)
    {
        using var details = await client.GetAsync($"/api/v1/appointments/{appointmentId}", Ct);
        details.StatusCode.ShouldBe(HttpStatusCode.OK);
        var warning = JsonNode.Parse(await details.Content.ReadAsStringAsync(Ct))!["competenceWarning"];
        if (warning is null) { return []; }
        warning["requiresReview"]!.GetValue<bool>().ShouldBeTrue();
        return [.. warning["reasonCodes"]!.AsArray().Select(r => r!.GetValue<string>())];
    }

    private static async Task<HttpResponseMessage> PutAsync(HttpClient client, string path, JsonNode body, string etag)
    {
        using var message = new HttpRequestMessage(HttpMethod.Put, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        message.Headers.TryAddWithoutValidation("If-Match", etag);
        return await client.SendAsync(message, Ct);
    }

    /// <summary>
    /// Once armed, pauses the next single-key <c>pg_advisory_xact_lock</c> (the dealership lock; the seeding lock has two keys): before it
    /// is sent, so every pre-lock read is done, or after it returns, so the booking holds the lock.
    /// </summary>
    private sealed class BookingLockPause(bool afterAcquired) : DbCommandInterceptor
    {
        private int _armed;
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Arm() => Interlocked.Exchange(ref _armed, 1);

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!afterAcquired) { await PauseAsync(command, cancellationToken); }
            return result;
        }

        public override async ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (afterAcquired) { await PauseAsync(command, cancellationToken); }
            return result;
        }

        private async Task PauseAsync(DbCommand command, CancellationToken cancellationToken)
        {
            if (command.CommandText.Contains("pg_advisory_xact_lock", StringComparison.Ordinal) && command.Parameters.Count == 1
                && Interlocked.Exchange(ref _armed, 0) == 1)
            {
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }
    }
}

using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// A commit that succeeded on the server but whose acknowledgement was lost (SYSTEM_DESIGN §7.4, transient row): the retrying execution
/// strategy runs the unit of work again, and that must not book a second appointment or turn a cancellation that happened into a 409.
/// Booking: the appointment id is minted once per request, the strategy verifies a failed commit by looking for it, and each run looks
/// for it again after taking the lock. Cancellation: the strategy verifies by the row version the cancel wrote (its <c>xmin</c>), and a
/// run after an in-doubt commit locks the row before reading it, so that read is conclusive.
/// </summary>
/// <remarks>
/// The fault is raised after the commit, from a transaction interceptor. Placed after the audit interceptor, the audit's post-commit
/// hook has already notified the observers (the reviewer's probe). Placed before it, the hook never runs and EF Core reports the commit
/// as failed, as a real dropped connection does: the events are then in doubt and released once the commit is verified.
/// </remarks>
public sealed class CommitFailureTests(PostgresFixture pg) : IAsyncLifetime
{
    private const string CancelReason = "Customer called to reschedule.";

    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    private readonly CommitAcknowledgementLoss _commitLoss = new();
    private readonly InconclusiveVerification _verification = new();
    private readonly CapturingLoggerProvider _logs = new();
    private SchedulerApiFactory _base = null!;
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;
    private TestData.Workshop _workshop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _base = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _base.ResetAsync();
        _workshop = await _base.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_factory is not null)
        {
            await _factory.DisposeAsync();
        }

        await _base.DisposeAsync();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Lost_commit_acknowledgement_books_once_without_a_key(bool faultBeforeAudit)
    {
        Start(faultBeforeAudit);
        _commitLoss.Arm();

        using var response = await PostAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten), key: null);

        _commitLoss.Fired.ShouldBe(1);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        await _base.WithDbAsync(async db =>
        {
            (await db.Appointments.Select(a => a.Id).ToListAsync(Ct)).ShouldBe([appointment.Id], "the retry must not book a second appointment");
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
        });
        _logs.Entries.Count(e => e.EventId.Id == 1001).ShouldBe(1, "BookingConfirmed once per committed appointment");

        // The only error is EF Core's report of the failed commit itself (an infrastructure fault worth seeing), not a booking error.
        _logs.Entries.Where(e => e.Level >= LogLevel.Error).Select(e => e.EventId.Name).ShouldBe(["Microsoft.EntityFrameworkCore.Database.Transaction.TransactionError"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Lost_commit_acknowledgement_books_once_with_a_key(bool faultBeforeAudit)
    {
        Start(faultBeforeAudit);
        _commitLoss.Arm();

        using var response = await PostAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten), key: "lost-ack");

        _commitLoss.Fired.ShouldBe(1);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        await _base.WithDbAsync(async db =>
        {
            (await db.Appointments.Select(a => a.Id).ToListAsync(Ct)).ShouldBe([appointment.Id]);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
            (await db.IdempotencyKeys.SingleAsync(Ct)).ResourceId.ShouldBe(appointment.Id);
        });
        _logs.Entries.Count(e => e.EventId.Id == 1001).ShouldBe(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("in-doubt")]
    public async Task Lost_commit_acknowledgement_the_verification_cannot_see_is_settled_under_the_lock(string? key)
    {
        // The commit happened, but the strategy's verification read before it was visible (here: its read answers no rows). That
        // "not found" is inconclusive, so it must leave the run's events in doubt: the next run takes the lock, finds the minted
        // appointment and releases them, once.
        Start(faultBeforeAudit: true);
        _commitLoss.Arm();
        _verification.Arm();

        using var response = await PostAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten), key);

        (_commitLoss.Fired, _verification.Fired).ShouldBe((1, 1), "a lost acknowledgement, then a verification that saw nothing");
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        await _base.WithDbAsync(async db =>
        {
            (await db.Appointments.Select(a => a.Id).ToListAsync(Ct)).ShouldBe([appointment.Id], "the in-lock check answers with the committed appointment");
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
        });
        _logs.Entries.Count(e => e.EventId.Id == 1001).ShouldBe(1, "the committed booking's events are released by the in-lock check, not dropped by the verification");
    }

    [Fact]
    public async Task A_commit_that_really_failed_is_retried_and_books_once()
    {
        // The fault fires before the commit reaches the server: nothing committed, the verification finds nothing, the run repeats.
        Start(faultBeforeAudit: false, beforeCommit: true);
        _commitLoss.Arm();

        using var response = await PostAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten), key: null);

        _commitLoss.Fired.ShouldBe(1);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        await _base.WithDbAsync(async db =>
        {
            (await db.Appointments.Select(a => a.Id).ToListAsync(Ct)).ShouldBe([appointment.Id], "the same minted id, booked by the second run");
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
        });
        _logs.Entries.Count(e => e.EventId.Id == 1001).ShouldBe(1, "the first run's events never committed, so they are never heard of");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Lost_commit_acknowledgement_of_a_cancel_answers_200_once(bool faultBeforeAudit)
    {
        var appointment = await SaveBookedAsync();
        Start(faultBeforeAudit);
        _commitLoss.Arm();

        using var response = await CancelAsync(appointment.Id);

        _commitLoss.Fired.ShouldBe(1);
        await ShouldBeCancelledOnceAsync(response, appointment.Id);
        _logs.Entries.Where(e => e.Level >= LogLevel.Error).Select(e => e.EventId.Name).ShouldBe(["Microsoft.EntityFrameworkCore.Database.Transaction.TransactionError"]);
    }

    [Fact]
    public async Task Lost_commit_acknowledgement_of_a_cancel_the_verification_cannot_see_is_settled_by_the_locked_read()
    {
        var appointment = await SaveBookedAsync();
        Start(faultBeforeAudit: true);
        _commitLoss.Arm();
        _verification.Arm();

        using var response = await CancelAsync(appointment.Id);

        (_commitLoss.Fired, _verification.Fired).ShouldBe((1, 1), "a lost acknowledgement, then a verification that saw nothing");
        await ShouldBeCancelledOnceAsync(response, appointment.Id);
    }

    [Fact]
    public async Task A_run_after_an_in_doubt_cancel_waits_for_the_row_lock_before_reading_the_row()
    {
        // While the verification runs, the test takes the appointment's row lock in its own transaction: it stands in for the earlier
        // run's transaction still open on the server (its COMMIT in flight). The next run must wait for that transaction to end before
        // it reads the row, or it could read the version before the commit and answer the client's own cancellation with a 409.
        var appointment = await SaveBookedAsync();
        await using var holder = new NpgsqlConnection(pg.ConnectionString);
        await holder.OpenAsync(Ct);
        NpgsqlTransaction? earlierRun = null;
        _verification.OnFired = async ct =>
        {
            earlierRun = await holder.BeginTransactionAsync(ct);
            await using var lockRow = new NpgsqlCommand("SELECT 1 FROM appointments WHERE id = @id FOR UPDATE", holder, earlierRun);
            lockRow.Parameters.AddWithValue("id", appointment.Id);
            await lockRow.ExecuteNonQueryAsync(ct);
        };
        Start(faultBeforeAudit: true);
        _commitLoss.Arm();
        _verification.Arm();

        var inFlight = CancelAsync(appointment.Id);
        await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
        await earlierRun.ShouldNotBeNull().CommitAsync(Ct);
        using var response = await inFlight;

        (_commitLoss.Fired, _verification.Fired).ShouldBe((1, 1));
        await ShouldBeCancelledOnceAsync(response, appointment.Id);
        await earlierRun.DisposeAsync();
    }

    [Fact]
    public async Task A_cancel_whose_commit_really_failed_is_retried_and_cancels_once()
    {
        // The fault fires before the commit reaches the server: nothing committed, the verification finds the old version, the run repeats.
        var appointment = await SaveBookedAsync();
        Start(faultBeforeAudit: true, beforeCommit: true);
        _commitLoss.Arm();

        using var response = await CancelAsync(appointment.Id);

        _commitLoss.Fired.ShouldBe(1);
        await ShouldBeCancelledOnceAsync(response, appointment.Id);
    }

    private async Task<Appointment> SaveBookedAsync()
    {
        var appointment = _workshop.Book(Ten);
        await _base.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
        });
        return appointment;
    }

    private Task<HttpResponseMessage> CancelAsync(Guid appointmentId) =>
        _client!.PostJsonAsync(
            $"/api/v1/appointments/{appointmentId}/cancel", new CancelAppointmentRequest(CancelReason), SchedulerJsonContext.Default.CancelAppointmentRequest, Ct);

    /// <summary>200 with the cancellation, one Cancelled history row, and AppointmentCancelled (1010) logged once.</summary>
    private async Task ShouldBeCancelledOnceAsync(HttpResponseMessage response, Guid appointmentId)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var cancelled = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        (cancelled.Id, cancelled.Status, cancelled.CancellationReason).ShouldBe((appointmentId, AppointmentStatus.Cancelled, CancelReason));
        await _base.WithDbAsync(async db =>
        {
            (await db.Appointments.AsNoTracking().SingleAsync(Ct)).Status.ShouldBe(AppointmentStatus.Cancelled);
            (await db.AppointmentHistory.Where(h => h.EventType == "Cancelled").CountAsync(Ct)).ShouldBe(1);
        });
        _logs.Entries.Count(e => e.EventId.Id == 1010).ShouldBe(1, "AppointmentCancelled once per committed cancellation");
    }

    private void Start(bool faultBeforeAudit, bool beforeCommit = false)
    {
        _commitLoss.BeforeCommit = beforeCommit;
        _factory = _base.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ILoggerProvider>(_logs);
            if (faultBeforeAudit)
            {
                // Options configurations apply in registration order: inserting ours first puts the fault ahead of the audit interceptor.
                var first = services.TakeWhile(d => d.ServiceType != typeof(IDbContextOptionsConfiguration<SchedulerDbContext>)).Count();
                services.Insert(first, ServiceDescriptor.Singleton<IDbContextOptionsConfiguration<SchedulerDbContext>>(new AddInterceptor(_commitLoss)));
            }
            else
            {
                services.ConfigureDbContext<SchedulerDbContext>(options => options.AddInterceptors(_commitLoss));
            }

            // Inert until armed.
            services.ConfigureDbContext<SchedulerDbContext>(options => options.AddInterceptors(_verification));
        }));
        _client = _factory.CreateClient();
    }

    private Task<HttpResponseMessage> PostAsync(BookAppointmentRequest request, string? key) =>
        _client!.PostJsonAsync(
            $"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments",
            request,
            SchedulerJsonContext.Default.BookAppointmentRequest,
            key is null ? null : new Dictionary<string, string> { ["Idempotency-Key"] = key },
            Ct);

    private sealed class AddInterceptor(CommitAcknowledgementLoss interceptor) : IDbContextOptionsConfiguration<SchedulerDbContext>
    {
        public void Configure(IServiceProvider serviceProvider, DbContextOptionsBuilder optionsBuilder) => optionsBuilder.AddInterceptors(interceptor);
    }
}

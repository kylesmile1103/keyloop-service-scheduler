using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// A commit that succeeded on the server but whose acknowledgement was lost (SYSTEM_DESIGN §7.4, transient row): the retrying execution
/// strategy runs the booking again, and that must not book a second appointment. The appointment id is minted once per request, the
/// strategy verifies a failed commit by looking for it, and each run looks for it again after taking the lock.
/// </summary>
/// <remarks>
/// The fault is raised after the commit, from a transaction interceptor. Placed after the audit interceptor, the audit's post-commit
/// hook has already notified the observers (the reviewer's probe). Placed before it, the hook never runs and EF Core reports the commit
/// as failed, as a real dropped connection does: the events are then in doubt and released once the commit is verified.
/// </remarks>
public sealed class CommitFailureTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    private readonly CommitAcknowledgementLoss _commitLoss = new();
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

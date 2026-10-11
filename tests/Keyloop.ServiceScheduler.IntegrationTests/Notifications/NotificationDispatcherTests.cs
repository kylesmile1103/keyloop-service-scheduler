using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.IntegrationTests.Notifications;

public sealed class NotificationDispatcherTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private readonly CapturingEmailSender _sender = new();
    private readonly CapturingLogger<NotificationDispatcher> _logger = new();
    private readonly NotificationOptions _options = new() { Enabled = true, Provider = NotificationProvider.Smtp, MaxAttempts = 3, BatchSize = 2 };
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }
    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();
    private NotificationDispatcher Dispatcher() => new(_factory.Services.GetRequiredService<IServiceScopeFactory>(), _sender,
        Options.Create(_options), _factory.Clock, _logger);
    private async Task BookAsync(int hour = 9) => await _factory.WithDbAsync(async db =>
    {
        db.Add(_workshop.Book(TestData.LondonTime(hour)));
        await db.SaveChangesAsync(Ct);
    });
    private Task<NotificationOutboxEntry> RowAsync() => _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().SingleAsync(Ct));

    [Fact]
    public async Task Sends_due_rows_marks_sent_and_records_metrics_without_pii()
    {
        await BookAsync();
        _factory.Clock.Advance(TimeSpan.FromSeconds(12));
        using var metrics = new MetricsCollector();
        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        var row = await RowAsync();
        row.Status.ShouldBe(NotificationStatus.Sent);
        row.SentAt.ShouldBe(_factory.Clock.GetUtcNow().UtcDateTime);
        row.Attempts.ShouldBe(1);
        row.ClaimToken.ShouldBeNull();
        _sender.Messages.ShouldHaveSingleItem().OutboxId.ShouldBe(row.Id);
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
        metrics.Sum("scheduler.notifications.sent", MetricsCollector.Tag("kind", "BookingConfirmation")).ShouldBe(1);
        metrics.Of("scheduler.notifications.outbox_age").ShouldHaveSingleItem().Value.ShouldBe(12);
        metrics.Max("scheduler.notifications.dispatch_duration").ShouldBeGreaterThan(0);
        var entry = _logger.Entries.ShouldHaveSingleItem();
        entry.EventId.Id.ShouldBe(1201);
        entry.Message.ShouldContain("c***@example.com");
        entry.Message.ShouldNotContain("customer1@example.com");
        entry.Message.ShouldNotContain("WVWZZZ");
    }

    [Fact]
    public async Task Failure_retries_only_when_due_and_stops_at_max_attempts()
    {
        await BookAsync();
        _sender.OnSend = (_, _) => Task.FromException(new InvalidOperationException("customer1@example.com private SMTP response"));
        using var metrics = new MetricsCollector();
        using var dispatcher = Dispatcher();
        var now = _factory.Clock.GetUtcNow().UtcDateTime;
        for (var attempt = 1; attempt <= _options.MaxAttempts; attempt++)
        {
            (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
            var row = await RowAsync();
            row.Attempts.ShouldBe(attempt);
            if (attempt < _options.MaxAttempts)
            {
                row.Status.ShouldBe(NotificationStatus.Pending);
                (row.NextAttemptAt - now).TotalSeconds.ShouldBeInRange(10 * Math.Pow(2, attempt - 1), 12 * Math.Pow(2, attempt - 1));
                (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0, "retry waits for next_attempt_at");
                _factory.Clock.SetUtcNow(new DateTimeOffset(row.NextAttemptAt));
                now = row.NextAttemptAt;
            }
            else
            {
                row.Status.ShouldBe(NotificationStatus.Failed);
                row.SentAt.ShouldBeNull();
            }
        }
        _factory.Clock.Advance(TimeSpan.FromDays(10));
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
        _sender.Messages.Count.ShouldBe(3);
        _sender.Messages.Select(m => m.MessageId).Distinct().ShouldHaveSingleItem();
        metrics.Sum("scheduler.notifications.retried").ShouldBe(2);
        metrics.Sum("scheduler.notifications.failed").ShouldBe(1);
        _logger.Entries.ShouldAllBe(e => e.Exception == null && !e.Message.Contains("private SMTP response") && !e.Message.Contains("customer1@example.com"));
    }

    [Fact]
    public async Task Two_dispatchers_never_send_a_leased_row_twice()
    {
        await BookAsync(9);
        await BookAsync(10);
        await BookAsync(11);
        await BookAsync(12);
        _sender.OnSend = async (_, ct) => await Task.Delay(TimeSpan.FromMilliseconds(100), ct);
        using var first = Dispatcher();
        using var second = Dispatcher();
        await Task.WhenAll(first.DispatchOnceAsync(Ct), second.DispatchOnceAsync(Ct));
        _sender.Messages.Count.ShouldBe(4);
        _sender.Messages.Select(m => m.OutboxId).Distinct().Count().ShouldBe(4);
        (await _factory.WithDbAsync(db => db.NotificationOutbox.CountAsync(e => e.Status == NotificationStatus.Sent, Ct))).ShouldBe(4);
    }

    [Fact]
    public async Task Locked_due_row_is_skipped_without_waiting_and_the_other_row_is_sent()
    {
        await BookAsync(9);
        await BookAsync(10);
        await using var lockedDb = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>()
            .UseNpgsql(pg.ConnectionString).UseSnakeCaseNamingConvention().Options);
        await using var tx = await lockedDb.Database.BeginTransactionAsync(Ct);
        var locked = (await lockedDb.NotificationOutbox.FromSqlRaw("SELECT * FROM notification_outbox ORDER BY id LIMIT 1 FOR UPDATE").ToListAsync(Ct)).Single();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var dispatcher = Dispatcher();
        try
        {
            (await dispatcher.DispatchOnceAsync(timeout.Token)).ShouldBe(1);
            _sender.Messages.ShouldHaveSingleItem().OutboxId.ShouldNotBe(locked.Id);
        }
        finally
        {
            await tx.RollbackAsync(Ct);
        }
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        _sender.Messages.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Expired_claim_is_recovered()
    {
        await BookAsync();
        await _factory.WithDbAsync(async db =>
        {
            var row = await db.NotificationOutbox.SingleAsync(Ct);
            row.Claim(TestData.Now, _options.ClaimLease);
            await db.SaveChangesAsync(Ct);
        });
        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
        _factory.Clock.Advance(_options.ClaimLease);
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        (await RowAsync()).Attempts.ShouldBe(2);
        _sender.Messages.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Expired_claim_at_max_attempts_is_dead_lettered_without_another_send()
    {
        await BookAsync();
        await _factory.WithDbAsync(async db =>
        {
            var row = await db.NotificationOutbox.SingleAsync(Ct);
            for (var i = 0; i < _options.MaxAttempts; i++)
            {
                row.Claim(TestData.Now, _options.ClaimLease);
            }
            await db.SaveChangesAsync(Ct);
        });
        _factory.Clock.Advance(_options.ClaimLease);
        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        var failed = await RowAsync();
        failed.Status.ShouldBe(NotificationStatus.Failed);
        failed.LastFailure.ShouldBe("LeaseExpired");
        failed.Attempts.ShouldBe(_options.MaxAttempts);
        _sender.Messages.ShouldBeEmpty();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
    }

    [Fact]
    public async Task Network_send_holds_no_database_lock_and_other_workers_respect_the_lease()
    {
        await BookAsync();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _sender.OnSend = async (_, ct) => { entered.TrySetResult(); await release.Task.WaitAsync(ct); };
        using var first = Dispatcher();
        using var second = Dispatcher();
        var sending = first.DispatchOnceAsync(Ct);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            (await second.DispatchOnceAsync(timeout.Token)).ShouldBe(0);
            var row = await RowAsync();
            row.ClaimToken.ShouldNotBeNull();
            row.Status.ShouldBe(NotificationStatus.Pending);
        }
        finally
        {
            release.TrySetResult();
            await sending;
        }
        _sender.Messages.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Shutdown_cancels_the_send_and_leaves_an_expiring_recoverable_claim()
    {
        await BookAsync();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _sender.OnSend = async (_, ct) => { entered.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, ct); };
        using var dispatcher = Dispatcher();
        using var shutdown = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        var sending = dispatcher.DispatchOnceAsync(shutdown.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        shutdown.Cancel();
        await sending.WaitAsync(TimeSpan.FromSeconds(5), Ct);
        var row = await RowAsync();
        row.Status.ShouldBe(NotificationStatus.Pending);
        row.ClaimToken.ShouldNotBeNull();
        row.NextAttemptAt.ShouldBe(TestData.Now + _options.ClaimLease);
        _sender.OnSend = null;
        _factory.Clock.Advance(_options.ClaimLease);
        await dispatcher.DispatchOnceAsync(Ct);
        (await RowAsync()).Status.ShouldBe(NotificationStatus.Sent);
    }

    [Fact]
    public async Task Stale_claim_cannot_mark_a_row_sent()
    {
        await BookAsync();
        _sender.OnSend = async (message, _) => await _factory.WithDbAsync(async db =>
        {
            await db.NotificationOutbox.Where(e => e.Id == message.OutboxId)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.ClaimToken, Guid.NewGuid()), Ct);
        });
        using var dispatcher = Dispatcher();
        await dispatcher.DispatchOnceAsync(Ct);
        (await RowAsync()).Status.ShouldBe(NotificationStatus.Pending);
        _logger.Entries.ShouldHaveSingleItem().EventId.Id.ShouldBe(1205);
    }

    [Fact]
    public async Task Booking_returns_201_and_creates_pending_email_when_the_sender_is_down()
    {
        _sender.OnSend = (_, _) => Task.FromException(new IOException("SMTP unavailable"));
        await using var enabled = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Notifications:Enabled", "true").UseSetting("Notifications:Provider", "Smtp")
            .UseSetting("Notifications:PollInterval", "00:00:00.100")
            .ConfigureTestServices(services => services.AddSingleton<IEmailSender>(_sender)));
        using var client = enabled.CreateClient();
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments",
            TestData.BookingRequest(_workshop.Interim.Id, TestData.LondonTime(9)), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        while ((await RowAsync()).LastFailure is null)
        {
            _factory.Clock.Advance(TimeSpan.FromMilliseconds(100));
            await Task.Delay(TimeSpan.FromMilliseconds(10), deadline.Token);
        }
        _sender.Messages.ShouldHaveSingleItem();
        (await RowAsync()).Status.ShouldBe(NotificationStatus.Pending);
    }

    [Fact]
    public async Task Disabled_dispatcher_does_no_work()
    {
        await BookAsync();
        _options.Enabled = false;
        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
        _sender.Messages.ShouldBeEmpty();
    }
}

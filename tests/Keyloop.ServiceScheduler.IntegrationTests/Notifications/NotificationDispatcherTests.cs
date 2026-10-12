using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.IntegrationTests.Notifications;

public sealed class NotificationDispatcherTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private readonly CapturingEmailSender _sender = new();
    private readonly CapturingLogger<NotificationDispatcher> _logger = new();
    private readonly CapturingLoggerProvider _logs = new();
    private readonly NotificationOptions _options = new() { Enabled = true, Provider = NotificationProvider.Smtp, MaxAttempts = 3, BatchSize = 2 };
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock(), _logs);
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }
    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
        _logs.Dispose();
    }
    private NotificationDispatcher Dispatcher() => new(_factory.Services.GetRequiredService<IServiceScopeFactory>(), _sender,
        new NotificationSignal(), Options.Create(_options), _factory.Clock, _logger);
    private async Task BookAsync(int hour = 9, string? email = null, DateTime? bookedAtUtc = null) => await _factory.WithDbAsync(async db =>
    {
        db.Add(_workshop.Book(TestData.LondonTime(hour), email: email ?? TestData.DeliverableEmail(), bookedAtUtc: bookedAtUtc));
        await db.SaveChangesAsync(Ct);
    });
    private Task<NotificationOutboxEntry> RowAsync() => _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().SingleAsync(Ct));
    private Task<NotificationOutboxEntry?> RowAsync(string recipient, NotificationStatus status) => _factory.WithDbAsync(db =>
        db.NotificationOutbox.AsNoTracking().SingleOrDefaultAsync(e => e.Recipient == recipient && e.Status == status, Ct));

    /// <summary>Books through a context without this host's observers, as another instance would: no nudge reaches the dispatcher.</summary>
    private async Task BookUnobservedAsync(int hour, string email)
    {
        await using var other = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString)
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(new DomainEventInterceptor(new CurrentActor(), [], NullLogger<DomainEventInterceptor>.Instance)).Options);
        other.Add(_workshop.Book(TestData.LondonTime(hour), email: email));
        await other.SaveChangesAsync(Ct);
    }

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
        _sender.Messages.ShouldHaveSingleItem().NotificationId.ShouldBe(row.Id);
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
        metrics.Sum("scheduler.notifications.sent", MetricsCollector.Tag("kind", "BookingConfirmation")).ShouldBe(1);
        metrics.Of("scheduler.notifications.outbox_age").ShouldHaveSingleItem().Value.ShouldBe(12);
        metrics.Max("scheduler.notifications.dispatch_duration").ShouldBeGreaterThan(0);
        var entry = _logger.Entries.ShouldHaveSingleItem();
        entry.EventId.ShouldBe(new Microsoft.Extensions.Logging.EventId(1300, "NotificationSent"));
        entry.Message.ShouldContain(row.Id.ToString());
        entry.Message.ShouldContain(row.AppointmentId.ToString());
        // No recipient at all, not even masked (A9), and nothing from the body.
        entry.Message.ShouldNotContain("@");
        entry.Message.ShouldNotContain("c***");
        entry.Message.ShouldNotContain("WVWZZZ");
    }

    [Theory]
    [InlineData("customer1@example.com")]
    [InlineData("Customer.One@Mail.EXAMPLE.org")]
    [InlineData("someone@workshop.test")]
    [InlineData("someone@localhost")]
    public async Task Reserved_domains_are_suppressed_when_staged_and_never_sent(string email)
    {
        // The fixed recipient policy decides when the row is staged, so it holds with dispatch disabled (this SystemTest host) and such a
        // row is never backlog. The suppression is counted and logged once, when its transaction commits, without the address.
        using var metrics = new MetricsCollector();
        await BookAsync(9, email);
        await BookAsync(10);
        var suppressed = await _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().SingleAsync(e => e.Recipient == email, Ct));
        (suppressed.Status, suppressed.LastFailure).ShouldBe((NotificationStatus.Suppressed, "ReservedDomain"));
        (suppressed.Attempts, suppressed.ClaimToken).ShouldBe((0, (Guid?)null), "no lease and no attempt");
        metrics.Sum("scheduler.notifications.suppressed", MetricsCollector.Tag("reason", "ReservedDomain")).ShouldBe(1);
        metrics.Sum("scheduler.notifications.suppressed", MetricsCollector.Tag("kind", "BookingConfirmation")).ShouldBe(1);
        var entry = _logs.Entries.Where(e => e.EventId.Id == 1305).ShouldHaveSingleItem();
        entry.Category.ShouldBe(typeof(DomainEventInterceptor).FullName);
        entry.Message.ShouldContain(suppressed.Id.ToString());
        entry.Message.ShouldContain("ReservedDomain");
        entry.Message.ShouldNotContain("@");

        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1, "only the deliverable row is claimed");
        _sender.Messages.ShouldHaveSingleItem().Recipient.ShouldBe(TestData.DeliverableEmail());
        _factory.Clock.Advance(TimeSpan.FromDays(10));
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0, "a suppressed row is terminal");
        _sender.Messages.Count.ShouldBe(1);
        metrics.Sum("scheduler.notifications.suppressed").ShouldBe(1, "counted once, when its transaction committed");
        metrics.Sum("scheduler.notifications.failed").ShouldBe(0, "suppression is policy, not a delivery failure");
        _logger.Entries.ShouldNotContain(e => e.EventId.Id == 1305);
    }

    [Fact]
    public async Task A_pending_row_on_a_reserved_domain_is_still_suppressed_at_claim()
    {
        // A Pending row on a reserved domain can only predate the staging rule or come from outside the application; the claim applies
        // the same policy before any lease or send.
        await BookAsync(9);
        await _factory.WithDbAsync(db => db.NotificationOutbox.ExecuteUpdateAsync(set => set.SetProperty(e => e.Recipient, "late@example.com"), Ct));
        using var metrics = new MetricsCollector();
        using var dispatcher = Dispatcher();

        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);

        _sender.Messages.ShouldBeEmpty();
        var row = await RowAsync();
        (row.Status, row.LastFailure, row.Attempts, row.ClaimToken).ShouldBe((NotificationStatus.Suppressed, "ReservedDomain", 0, (Guid?)null));
        metrics.Sum("scheduler.notifications.suppressed", MetricsCollector.Tag("reason", "ReservedDomain")).ShouldBe(1);
        _logger.Entries.Single(e => e.EventId.Id == 1305).Message.ShouldNotContain("@");
    }

    [Fact]
    public async Task The_email_is_rendered_at_dispatch_and_the_cancellation_notice_has_no_visitor_text()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9), email: TestData.DeliverableEmail());
        await _factory.WithDbAsync(async db =>
        {
            db.Add(appointment);
            await db.SaveChangesAsync(Ct);
            appointment.Cancel("Visit https://phish.example.net to rebook", TestData.Now.AddMinutes(5));
            await db.SaveChangesAsync(Ct);
        });
        _factory.Clock.Advance(TimeSpan.FromMinutes(5)); // the cancellation row is due from its event time
        using var dispatcher = Dispatcher();
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(2);
        _sender.Messages.Count.ShouldBe(2);
        var cancellation = _sender.Messages.Single(m => m.Subject.StartsWith("Booking cancelled", StringComparison.Ordinal));
        var confirmation = _sender.Messages.Single(m => m.Subject.StartsWith("Booking confirmation", StringComparison.Ordinal));
        foreach (var message in new[] { cancellation, confirmation })
        {
            message.Recipient.ShouldBe(TestData.DeliverableEmail());
            message.TextBody.ShouldContain("Test Motors");
            message.TextBody.ShouldContain("Tuesday 13 October 2026, 09:00 (UTC+01:00, Europe/London)");
            message.TextBody.ShouldContain("*************3456");
            foreach (var body in new[] { message.Subject, message.TextBody, message.HtmlBody })
            {
                body.ShouldNotContain("phish");
                body.ShouldNotContain("Customer 1");
                body.ShouldNotContain(appointment.Vehicle.Vin.Value);
            }
        }
        cancellation.TextBody.ShouldContain("Your service booking has been cancelled.");
    }

    [Fact]
    public async Task A_row_that_cannot_be_rendered_is_a_dead_letter_without_a_send_and_the_rest_of_the_batch_is_sent()
    {
        await BookAsync(9);
        await _factory.WithDbAsync(async db =>
        {
            // A second dealership offering the same service: its row stays renderable.
            var dealership = TestData.NewDealership("Other Motors");
            var bay = TestData.NewBay(dealership.Id, "Bay 1", Keyloop.ServiceScheduler.Domain.Resources.BayCapability.StandardLift);
            var technician = TestData.NewTechnician(dealership.Id, "Chloe Evans", "T-2001", Keyloop.ServiceScheduler.Domain.Resources.Certification.GeneralService);
            db.AddRange(dealership, bay, technician);
            await db.SaveChangesAsync(Ct);
            db.Add(TestData.NewAppointment(dealership, _workshop.Interim, bay, technician, TestData.LondonTime(10), email: TestData.DeliverableEmail(2)));
            await db.SaveChangesAsync(Ct);
        });
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE dealerships SET time_zone_id = 'Mars/Olympus_Mons' WHERE id = {_workshop.Dealership.Id}", Ct));
        using var metrics = new MetricsCollector();
        using var dispatcher = Dispatcher();

        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(2);

        _sender.Messages.ShouldHaveSingleItem().Recipient.ShouldBe(TestData.DeliverableEmail(2));
        var failed = await _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().SingleAsync(e => e.Recipient == TestData.DeliverableEmail(), Ct));
        failed.Status.ShouldBe(NotificationStatus.Failed, "deterministic: a retry cannot render it either");
        failed.LastFailure.ShouldBe("RenderFailed");
        failed.ClaimToken.ShouldBeNull();
        metrics.Sum("scheduler.notifications.failed").ShouldBe(1);
        metrics.Sum("scheduler.notifications.sent").ShouldBe(1);
        _logger.Entries.Single(e => e.EventId.Id == 1302).Message.ShouldContain("RenderFailed");
    }

    [Fact]
    public async Task An_accepted_send_is_acknowledged_even_when_shutdown_begins_before_the_acknowledgement()
    {
        await BookAsync();
        using var shutdown = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        _sender.OnSend = async (_, _) => await shutdown.CancelAsync();
        using var dispatcher = Dispatcher();
        await dispatcher.DispatchOnceAsync(shutdown.Token);
        (await RowAsync()).Status.ShouldBe(NotificationStatus.Sent, "the provider accepted it; leaving the lease would send it twice");
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
        _sender.Messages.Select(m => m.NotificationId).Distinct().ShouldHaveSingleItem();
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
        _sender.Messages.Select(m => m.NotificationId).Distinct().Count().ShouldBe(4);
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
            _sender.Messages.ShouldHaveSingleItem().NotificationId.ShouldNotBe(locked.Id);
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
            await db.NotificationOutbox.Where(e => e.Id == message.NotificationId)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.ClaimToken, Guid.NewGuid()), Ct);
        });
        using var dispatcher = Dispatcher();
        await dispatcher.DispatchOnceAsync(Ct);
        (await RowAsync()).Status.ShouldBe(NotificationStatus.Pending);
        _logger.Entries.ShouldHaveSingleItem().EventId.ShouldBe(new Microsoft.Extensions.Logging.EventId(1304, "NotificationClaimLost"));
    }

    [Fact]
    public async Task Booking_returns_201_when_the_sender_is_down_and_the_retry_wakes_when_due()
    {
        _sender.OnSend = (_, _) => Task.FromException(new IOException("SMTP unavailable"));
        await using var enabled = EnabledHost();
        using var client = enabled.CreateClient();
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments",
            TestData.BookingRequest(_workshop.Interim.Id, TestData.LondonTime(9), email: TestData.DeliverableEmail()),
            SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));

        // The commit nudges the hosted dispatcher: the first attempt needs no clock movement and no polling interval.
        var failed = await EventuallyAsync(async () => await RowAsync() is { LastFailure: not null } row ? row : null);
        failed.Status.ShouldBe(NotificationStatus.Pending);
        failed.Attempts.ShouldBe(1);
        _sender.Messages.ShouldHaveSingleItem();

        // The dispatcher then sleeps until the retry is due (next_attempt_at), not for a fixed poll or the idle interval. The business
        // clock moves in one-second steps, so the outcome does not depend on when the dispatcher read the clock to compute its sleep.
        _sender.OnSend = null;
        var sent = await EventuallyAsync(async () =>
        {
            _factory.Clock.Advance(TimeSpan.FromSeconds(1));
            return await RowAsync() is { Status: NotificationStatus.Sent } row ? row : null;
        });
        sent.Attempts.ShouldBe(2);
        var sentAt = sent.SentAt.ShouldNotBeNull();
        sentAt.ShouldBeGreaterThanOrEqualTo(failed.NextAttemptAt, "never before the retry is due");
        (sentAt - failed.NextAttemptAt).ShouldBeLessThan(TimeSpan.FromMinutes(5), "woken by the due time, not by the 15-minute idle wake");
        _sender.Messages.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Rows_nobody_nudged_are_drained_at_start_and_later_picked_up_by_a_timed_wake()
    {
        // Both rows are committed without this host's observers, as by another instance: no nudge ever reaches its dispatcher.
        await BookUnobservedAsync(9, TestData.DeliverableEmail(1));
        await using var enabled = EnabledHost();
        _ = enabled.Services; // starts the hosted dispatcher, which drains once
        await EventuallyAsync(() => RowAsync(TestData.DeliverableEmail(1), NotificationStatus.Sent));

        // The start drain claimed before the second row existed (it claimed the first row before sending it), so the dispatcher is
        // now asleep on the business clock, which stands still: nothing sends the second row.
        await BookUnobservedAsync(10, TestData.DeliverableEmail(2));
        await Task.Delay(TimeSpan.FromMilliseconds(300), Ct);
        (await RowAsync(TestData.DeliverableEmail(2), NotificationStatus.Pending)).ShouldNotBeNull().Attempts.ShouldBe(0);
        _sender.Messages.ShouldHaveSingleItem();

        // Without any nudge, a timed wake picks it up within the idle interval (or at its due time, if the dispatcher's next-due
        // read already saw it): the business clock moves a minute at a time.
        var idle = enabled.Services.GetRequiredService<IOptions<NotificationOptions>>().Value.IdleInterval;
        var started = _factory.Clock.GetUtcNow();
        await EventuallyAsync(() =>
        {
            _factory.Clock.Advance(TimeSpan.FromMinutes(1));
            return RowAsync(TestData.DeliverableEmail(2), NotificationStatus.Sent);
        });
        (_factory.Clock.GetUtcNow() - started).ShouldBeLessThanOrEqualTo(idle + TimeSpan.FromMinutes(2));
        _sender.Messages.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Seeded_demo_bookings_never_reach_the_sender()
    {
        // DemoAppointmentSeeder books every demo customer at @example.com through the aggregate, so every seed, week top-up and reseed
        // stages confirmations (proposal 2.6). The reserved-domain rule ends each one, when it is staged, without a send.
        await _factory.ResetAsync();
        var seeded = await _factory.WithDbAsync(async db =>
        {
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
            return await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct);
        });
        seeded.ShouldBeGreaterThan(0);
        using var dispatcher = Dispatcher();
        for (var cycle = 0; cycle < 100 && await dispatcher.DispatchOnceAsync(Ct) > 0; cycle++)
        {
        }

        _sender.Messages.ShouldBeEmpty();
        var rows = await _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().ToListAsync(Ct));
        rows.Count.ShouldBe(seeded);
        rows.ShouldAllBe(e => e.Status == NotificationStatus.Suppressed && e.LastFailure == "ReservedDomain" && e.Attempts == 0);
    }

    [Fact]
    public async Task Backlog_gauges_report_only_pending_rows_and_the_oldest_pending_age_while_dispatch_is_disabled()
    {
        // SystemTest defaults to Enabled=false, Provider=None: the host's dispatcher never runs, the backlog must still be visible (G2).
        // Terminal rows come first and are older, so the gauges fail if they count or age anything but Pending rows: one Sent (by a
        // dispatcher of the test's own) and one Suppressed (a reserved domain), both a minute older than the two Pending rows.
        var terminalAt = _factory.Clock.GetUtcNow().UtcDateTime;
        await BookAsync(8, TestData.DeliverableEmail(1), terminalAt);
        await BookAsync(9, "customer9@example.com", terminalAt);
        using (var dispatcher = Dispatcher())
        {
            await dispatcher.DispatchOnceAsync(Ct);
        }
        (await _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().Select(e => e.Status).ToListAsync(Ct)))
            .ShouldBe([NotificationStatus.Sent, NotificationStatus.Suppressed], ignoreOrder: true);

        _factory.Clock.Advance(TimeSpan.FromSeconds(60));
        var pendingAt = _factory.Clock.GetUtcNow().UtcDateTime;
        await BookAsync(10, TestData.DeliverableEmail(2), pendingAt);
        await BookAsync(11, TestData.DeliverableEmail(3), pendingAt);
        _factory.Clock.Advance(TimeSpan.FromSeconds(90));
        using var metrics = new MetricsCollector();
        await EventuallyAsync(() =>
        {
            metrics.Observe();
            return Task.FromResult(metrics.Of("scheduler.notifications.outbox_pending").Count > 0 ? metrics : null);
        });
        var latestPending = metrics.Of("scheduler.notifications.outbox_pending").GroupBy(m => m.Tag("kind")).ToDictionary(g => g.Key!, g => g.Last().Value);
        latestPending["BookingConfirmation"].ShouldBe(2, "the Sent and Suppressed rows are not backlog");
        latestPending["Cancellation"].ShouldBe(0);
        metrics.Of("scheduler.notifications.oldest_pending_age").Last().Value.ShouldBe(90, "the oldest Pending row's age, not an older terminal row's (150 s)");
    }

    [Fact]
    public async Task Demo_seeding_with_dispatch_disabled_reports_no_false_backlog()
    {
        // Demo (the published Compose bundle) migrates and seeds at startup with dispatch off. Every seeded customer is @example.com, so
        // every staged email is Suppressed at once: the backlog gauges, and the oldest_pending_age alert (ARCHITECTURE §12.3), see no
        // backlog that would never drain. Each suppression is still counted and logged once.
        var connectionString = await pg.CreateEmptyDatabaseAsync("demo_notification_backlog", Ct);
        using var logs = new CapturingLoggerProvider();
        using var metrics = new MetricsCollector();
        await using var demo = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Demo")
            .UseSetting("ConnectionStrings:schedulerdb", connectionString)
            .ConfigureServices(services => services.AddSingleton<TimeProvider>(TestData.Clock()).AddSingleton<ILoggerProvider>(logs)));
        using var client = demo.CreateClient();
        (await client.GetAsync("/health", Ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
        demo.Services.GetRequiredService<IOptions<NotificationOptions>>().Value.Enabled.ShouldBeFalse("Demo inherits dispatch off");

        List<NotificationOutboxEntry> rows;
        using (var scope = demo.Services.CreateScope())
        {
            rows = await scope.ServiceProvider.GetRequiredService<SchedulerDbContext>().NotificationOutbox.AsNoTracking().ToListAsync(Ct);
        }
        rows.ShouldNotBeEmpty("the demo week is seeded through the aggregate, so its confirmations are staged");
        rows.ShouldAllBe(e => e.Status == NotificationStatus.Suppressed && e.LastFailure == "ReservedDomain" && e.Attempts == 0);
        metrics.Sum("scheduler.notifications.suppressed", MetricsCollector.Tag("reason", "ReservedDomain")).ShouldBe(rows.Count);
        logs.Entries.Where(e => e.EventId.Id == 1305).Select(e => e.Message).ShouldAllBe(message => !message.Contains('@'));
        logs.Entries.Count(e => e.EventId.Id == 1305).ShouldBe(rows.Count);

        await EventuallyAsync(() =>
        {
            metrics.Observe();
            return Task.FromResult(metrics.Of("scheduler.notifications.outbox_pending").Count > 0 ? metrics : null);
        });
        var latestPending = metrics.Of("scheduler.notifications.outbox_pending").GroupBy(m => m.Tag("kind")).ToDictionary(g => g.Key!, g => g.Last().Value);
        latestPending.ShouldBe(new Dictionary<object, double> { ["BookingConfirmation"] = 0, ["Cancellation"] = 0 }, ignoreOrder: true);
        metrics.Of("scheduler.notifications.oldest_pending_age").Last().Value.ShouldBe(0, "no Pending row: nothing to alert on");
    }

    private WebApplicationFactory<Program> EnabledHost() => _factory.WithWebHostBuilder(builder => builder
        .UseSetting("Notifications:Enabled", "true").UseSetting("Notifications:Provider", "Smtp")
        .ConfigureTestServices(services => services.AddSingleton<IEmailSender>(_sender)));

    private static async Task<T> EventuallyAsync<T>(Func<Task<T?>> probe) where T : class
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        while (true)
        {
            if (await probe() is { } result)
            {
                return result;
            }
            await Task.Delay(TimeSpan.FromMilliseconds(20), deadline.Token);
        }
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

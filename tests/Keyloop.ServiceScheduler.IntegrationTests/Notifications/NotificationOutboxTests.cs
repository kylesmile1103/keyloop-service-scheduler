using System.Data.Common;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Notifications;

public sealed class NotificationOutboxTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }
    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Booking_writes_exactly_one_outbox_row_with_the_history_and_rollback_writes_none()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9), email: TestData.DeliverableEmail());
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
            await db.SaveChangesAsync(Ct);
        });
        var row = (await RowsAsync()).ShouldHaveSingleItem();
        row.AppointmentId.ShouldBe(appointment.Id);
        row.Kind.ShouldBe(NotificationKind.BookingConfirmation);
        row.Recipient.ShouldBe(TestData.DeliverableEmail());
        row.Status.ShouldBe(NotificationStatus.Pending);
        // A snapshot of the aggregate, rendered at dispatch: ids and times, the registration and only the VIN's last four characters.
        row.ReadSnapshot().ShouldBe(new NotificationSnapshot(appointment.Id, _workshop.Dealership.Id, _workshop.Interim.Id,
            appointment.Slot.StartUtc, appointment.Slot.EndUtc, "AB12 CDE", "3456"));
        row.Payload.ShouldNotContain(appointment.Vehicle.Vin.Value);
        row.Payload.ShouldNotContain(appointment.Customer.Name);
        (await _factory.WithDbAsync(db => db.AppointmentHistory.CountAsync(Ct))).ShouldBe(1);

        var rolledBack = _workshop.Book(TestData.LondonTime(11));
        await using (var db = NewContext())
        {
            await using var tx = await db.Database.BeginTransactionAsync(Ct);
            db.Appointments.Add(rolledBack);
            await db.SaveChangesAsync(Ct);
            (await db.NotificationOutbox.CountAsync(e => e.AppointmentId == rolledBack.Id, Ct)).ShouldBe(1, "staged before commit");
            await tx.RollbackAsync(Ct);
        }
        (await RowsAsync()).ShouldHaveSingleItem().Id.ShouldBe(row.Id);
        (await _factory.WithDbAsync(db => db.Appointments.CountAsync(a => a.Id == rolledBack.Id, Ct))).ShouldBe(0);
        (await _factory.WithDbAsync(db => db.AppointmentHistory.CountAsync(h => h.AppointmentId == rolledBack.Id, Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task Cancellation_writes_its_own_row_and_preserves_the_confirmation_snapshot()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db =>
        {
            db.Add(appointment);
            await db.SaveChangesAsync(Ct);
            appointment.Cancel("Customer rescheduled", TestData.Now.AddMinutes(5));
            await db.SaveChangesAsync(Ct);
        });
        var rows = await RowsAsync();
        rows.Count.ShouldBe(2);
        // The reason is free text typed by an anonymous visitor (ADR-010): it is not even stored for the email (proposal 2.4, A8).
        rows.ShouldAllBe(e => !e.Payload.Contains("Customer rescheduled"));
        var cancellation = rows.Single(e => e.Kind == NotificationKind.Cancellation);
        cancellation.ReadSnapshot().ShouldBe(rows.Single(e => e.Kind == NotificationKind.BookingConfirmation).ReadSnapshot());
        cancellation.CreatedAt.ShouldBe(TestData.Now.AddMinutes(5));
    }

    [Fact]
    public async Task Staging_reads_nothing_so_a_booking_or_cancel_gains_no_round_trip()
    {
        // The booking's dealership and service type are loaded untracked by the handler, so any lookup here would be an extra
        // SELECT inside the advisory-lock critical section (ADR-003). Rendering happens at dispatch instead.
        var commands = new CommandRecorder();
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await using (var db = NewContext(commands))
        {
            db.Add(appointment);
            await db.SaveChangesAsync(Ct);
            appointment.Cancel("Customer rescheduled", TestData.Now.AddMinutes(5));
            await db.SaveChangesAsync(Ct);
        }
        commands.Texts.Count.ShouldBe(2, string.Join(Environment.NewLine, commands.Texts));
        commands.Texts.ShouldAllBe(text => !text.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
            && !text.Contains("FROM dealerships", StringComparison.Ordinal) && !text.Contains("FROM service_types", StringComparison.Ordinal));
        (await RowsAsync()).Count.ShouldBe(2);
    }

    [Fact]
    public async Task A_cancel_saves_even_when_its_email_cannot_be_rendered_now()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db => { db.Add(appointment); await db.SaveChangesAsync(Ct); });
        // Unrenderable at this moment (an unknown zone); staging must not depend on it (A2).
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE dealerships SET time_zone_id = 'Mars/Olympus_Mons' WHERE id = {_workshop.Dealership.Id}", Ct));
        await _factory.WithDbAsync(async db =>
        {
            var tracked = await db.Appointments.SingleAsync(a => a.Id == appointment.Id, Ct);
            tracked.Cancel("Customer rescheduled", TestData.Now.AddMinutes(5));
            await db.SaveChangesAsync(Ct);
        });
        (await RowsAsync()).Count(e => e.Kind == NotificationKind.Cancellation).ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointment.Id, Ct))).Status
            .ShouldBe(Keyloop.ServiceScheduler.Domain.Scheduling.AppointmentStatus.Cancelled);
    }

    [Fact]
    public async Task Failed_save_detaches_outbox_rows_and_keeps_the_event_for_retry()
    {
        await _factory.WithDbAsync(async db => { db.Add(_workshop.Book(TestData.LondonTime(9))); await db.SaveChangesAsync(Ct); });
        var clash = _workshop.Book(TestData.LondonTime(9, 30));
        await _factory.WithDbAsync(async db =>
        {
            db.Add(clash);
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
            db.ChangeTracker.Entries<NotificationOutboxEntry>().ShouldBeEmpty();
            clash.DomainEvents.ShouldHaveSingleItem();
        });
        (await RowsAsync()).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Idempotent_booking_replay_does_not_enqueue_a_second_confirmation()
    {
        using var client = _factory.CreateClient();
        var request = TestData.BookingRequest(_workshop.Interim.Id, TestData.LondonTime(9));
        for (var i = 0; i < 2; i++)
        {
            using var response = await client.PostJsonAsync($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments", request,
                SchedulerJsonContext.Default.BookAppointmentRequest, new Dictionary<string, string> { ["Idempotency-Key"] = "task-19-replay" }, Ct);
            response.StatusCode.ShouldBe(System.Net.HttpStatusCode.Created);
        }
        (await RowsAsync()).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Lost_commit_acknowledgement_still_has_exactly_one_durable_notification()
    {
        var loss = new CommitAcknowledgementLoss();
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await using var db = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString)
            .UseSnakeCaseNamingConvention().AddInterceptors(loss,
                new DomainEventInterceptor(new CurrentActor(), [], NullLogger<DomainEventInterceptor>.Instance)).Options);
        await using var tx = await db.Database.BeginTransactionAsync(Ct);
        db.Add(appointment);
        await db.SaveChangesAsync(Ct);
        loss.Arm();
        await Should.ThrowAsync<Npgsql.NpgsqlException>(() => tx.CommitAsync(Ct));
        (await RowsAsync()).ShouldHaveSingleItem().AppointmentId.ShouldBe(appointment.Id);
    }

    [Fact]
    public async Task Parallel_cancellations_produce_one_notice_and_no_server_errors()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db => { db.Add(appointment); await db.SaveChangesAsync(Ct); });
        using var client = _factory.CreateClient();
        var responses = await Task.WhenAll(Enumerable.Range(0, 12).Select(i => client.PostJsonAsync(
            $"/api/v1/appointments/{appointment.Id}/cancel", new CancelAppointmentRequest($"Cancellation request {i}"),
            SchedulerJsonContext.Default.CancelAppointmentRequest, Ct)));
        try
        {
            responses.Count(r => r.StatusCode == System.Net.HttpStatusCode.OK).ShouldBe(1);
            responses.Count(r => r.StatusCode == System.Net.HttpStatusCode.Conflict).ShouldBe(11);
            var rows = await RowsAsync();
            rows.Count.ShouldBe(2);
            rows.Count(e => e.Kind == NotificationKind.Cancellation).ShouldBe(1);
            (await _factory.WithDbAsync(db => db.AppointmentHistory.CountAsync(h => h.AppointmentId == appointment.Id, Ct))).ShouldBe(2);
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task A_staged_suppression_is_counted_and_logged_only_once_its_transaction_has_committed()
    {
        // Like the domain events: a rolled-back staging counts nothing, a caller's transaction counts at its commit, an implicit one at
        // once, and an in-doubt commit only when the caller settles it as committed (SYSTEM_DESIGN §5.6, §7.3).
        using var metrics = new MetricsCollector();
        var logger = new CapturingLogger<DomainEventInterceptor>();
        long Suppressed() => metrics.Sum("scheduler.notifications.suppressed", MetricsCollector.Tag("reason", "ReservedDomain"));

        await using (var db = NewContext(logger))
        {
            await using (var rolledBack = await db.Database.BeginTransactionAsync(Ct))
            {
                db.Add(_workshop.Book(TestData.LondonTime(9)));
                await db.SaveChangesAsync(Ct);
                await rolledBack.RollbackAsync(Ct);
            }
            Suppressed().ShouldBe(0, "rolled back");
            db.ChangeTracker.Clear();

            await using (var committed = await db.Database.BeginTransactionAsync(Ct))
            {
                db.Add(_workshop.Book(TestData.LondonTime(10)));
                await db.SaveChangesAsync(Ct);
                Suppressed().ShouldBe(0, "not before the commit");
                await committed.CommitAsync(Ct);
            }
            Suppressed().ShouldBe(1);

            db.Add(_workshop.Book(TestData.LondonTime(11)));
            await db.SaveChangesAsync(Ct);
            Suppressed().ShouldBe(2, "an implicit transaction has committed when SaveChanges returns");
        }

        var loss = new CommitAcknowledgementLoss();
        var interceptor = new DomainEventInterceptor(new CurrentActor(), [], logger);
        await using (var db = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString)
            .UseSnakeCaseNamingConvention().AddInterceptors(loss, interceptor).Options))
        {
            await using var tx = await db.Database.BeginTransactionAsync(Ct);
            db.Add(_workshop.Book(TestData.LondonTime(12)));
            await db.SaveChangesAsync(Ct);
            loss.Arm();
            await Should.ThrowAsync<Npgsql.NpgsqlException>(() => tx.CommitAsync(Ct));
        }
        Suppressed().ShouldBe(2, "in doubt until the caller settles it");
        await interceptor.ResolveInDoubtCommitAsync(committed: true, Ct);
        Suppressed().ShouldBe(3);
        await interceptor.ResolveInDoubtCommitAsync(committed: true, Ct);
        Suppressed().ShouldBe(3, "settled once");

        (await RowsAsync()).Where(e => e.Status == NotificationStatus.Suppressed).Count().ShouldBe(3);
        logger.Entries.Count(e => e.EventId.Id == 1305).ShouldBe(3);
        logger.Entries.ShouldAllBe(e => e.EventId.Id == 1305 && !e.Message.Contains('@'));
    }

    [Fact]
    public async Task Duplicate_kind_is_deferred_until_commit_but_cannot_be_committed()
    {
        await _factory.WithDbAsync(async db =>
        {
            db.Add(_workshop.Book(TestData.LondonTime(9)));
            await db.SaveChangesAsync(Ct);
        });
        await using var connection = new Npgsql.NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var tx = await connection.BeginTransactionAsync(Ct);
        await using var duplicate = new Npgsql.NpgsqlCommand("""
            INSERT INTO notification_outbox
                (id, appointment_id, kind, recipient, payload, created_at, next_attempt_at, status, attempts)
            SELECT gen_random_uuid(), appointment_id, kind, recipient, payload, created_at, next_attempt_at, status, attempts
            FROM notification_outbox LIMIT 1
            """, connection, tx);
        // The appointment UPDATE's xmin check must get a chance to reject a stale cancel before duplicate notification checking.
        (await duplicate.ExecuteNonQueryAsync(Ct)).ShouldBe(1);
        var rejected = await Should.ThrowAsync<Npgsql.PostgresException>(() => tx.CommitAsync(Ct));
        rejected.SqlState.ShouldBe("23505");
        rejected.ConstraintName.ShouldBe("ak_notification_outbox_appointment_id_kind");
        (await RowsAsync()).ShouldHaveSingleItem();
    }

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly List<string> _texts = [];
        public IReadOnlyList<string> Texts => _texts;
        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            _texts.Add(command.CommandText);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            _texts.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }

        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            _texts.Add(command.CommandText);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            _texts.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }

    private Task<List<NotificationOutboxEntry>> RowsAsync() => _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().ToListAsync(Ct));
    private SchedulerDbContext NewContext(params IInterceptor[] extra) => NewContext(NullLogger<DomainEventInterceptor>.Instance, extra);
    private SchedulerDbContext NewContext(ILogger<DomainEventInterceptor> logger, params IInterceptor[] extra) => new(new DbContextOptionsBuilder<SchedulerDbContext>()
        .UseNpgsql(pg.ConnectionString).UseSnakeCaseNamingConvention()
        .AddInterceptors([.. extra, new DomainEventInterceptor(new CurrentActor(), [], logger)]).Options);
}

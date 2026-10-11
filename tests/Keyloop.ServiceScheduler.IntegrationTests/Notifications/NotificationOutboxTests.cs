using System.Data.Common;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

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
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
            await db.SaveChangesAsync(Ct);
        });
        var row = (await RowsAsync()).ShouldHaveSingleItem();
        row.AppointmentId.ShouldBe(appointment.Id);
        row.Kind.ShouldBe(NotificationKind.BookingConfirmation);
        row.Recipient.ShouldBe("customer1@example.com");
        row.Status.ShouldBe(NotificationStatus.Pending);
        row.TextBody.ShouldContain("Test Motors");
        row.TextBody.ShouldContain("*************3456");
        row.TextBody.ShouldNotContain(appointment.Vehicle.Vin.Value);
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
        rows.Single(e => e.Kind == NotificationKind.Cancellation).TextBody.ShouldContain("Customer rescheduled");
        rows.Single(e => e.Kind == NotificationKind.BookingConfirmation).TextBody.ShouldNotContain("Customer rescheduled");
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
                (id, appointment_id, kind, recipient, subject, text_body, html_body, created_at, next_attempt_at, status, attempts)
            SELECT gen_random_uuid(), appointment_id, kind, recipient, subject, text_body, html_body, created_at, next_attempt_at, status, attempts
            FROM notification_outbox LIMIT 1
            """, connection, tx);
        // The appointment UPDATE's xmin check must get a chance to reject a stale cancel before duplicate notification checking.
        (await duplicate.ExecuteNonQueryAsync(Ct)).ShouldBe(1);
        var rejected = await Should.ThrowAsync<Npgsql.PostgresException>(() => tx.CommitAsync(Ct));
        rejected.SqlState.ShouldBe("23505");
        rejected.ConstraintName.ShouldBe("ak_notification_outbox_appointment_id_kind");
        (await RowsAsync()).ShouldHaveSingleItem();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Snapshot_query_failure_detaches_staged_rows_and_a_retry_writes_each_once(bool synchronous)
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await using var db = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString)
            .UseSnakeCaseNamingConvention().AddInterceptors(new FailFirstSnapshotQuery(),
                new DomainEventInterceptor(new CurrentActor(), [], NullLogger<DomainEventInterceptor>.Instance)).Options);
        db.Add(appointment);
        if (synchronous)
        {
            Should.Throw<IOException>(() => db.SaveChanges());
        }
        else
        {
            await Should.ThrowAsync<IOException>(() => db.SaveChangesAsync(Ct));
        }
        db.ChangeTracker.Entries<AppointmentHistoryEntry>().ShouldBeEmpty();
        db.ChangeTracker.Entries<NotificationOutboxEntry>().ShouldBeEmpty();
        appointment.DomainEvents.ShouldHaveSingleItem();

        await db.SaveChangesAsync(Ct);
        (await RowsAsync()).ShouldHaveSingleItem().AppointmentId.ShouldBe(appointment.Id);
        (await _factory.WithDbAsync(context => context.AppointmentHistory.CountAsync(h => h.AppointmentId == appointment.Id, Ct))).ShouldBe(1);
    }

    private sealed class FailFirstSnapshotQuery : DbCommandInterceptor
    {
        private int _armed = 1;
        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            FailIfArmed(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            FailIfArmed(command);
            return ValueTask.FromResult(result);
        }

        private void FailIfArmed(DbCommand command)
        {
            if (command.CommandText.Contains("FROM dealerships", StringComparison.Ordinal) && Interlocked.Exchange(ref _armed, 0) == 1)
            {
                throw new IOException("Simulated snapshot query failure");
            }
        }
    }

    private Task<List<NotificationOutboxEntry>> RowsAsync() => _factory.WithDbAsync(db => db.NotificationOutbox.AsNoTracking().ToListAsync(Ct));
    private SchedulerDbContext NewContext() => new(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString)
        .UseSnakeCaseNamingConvention().AddInterceptors(new DomainEventInterceptor(new CurrentActor(), [], NullLogger<DomainEventInterceptor>.Instance)).Options);
}

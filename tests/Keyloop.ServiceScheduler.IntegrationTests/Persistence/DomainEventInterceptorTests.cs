using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class DomainEventInterceptorTests(PostgresFixture pg) : IAsyncLifetime
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
    public async Task Booking_writes_history_row_in_same_transaction()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
        });

        var history = await HistoryOfAsync(appointment.Id);
        var entry = history.ShouldHaveSingleItem();
        entry.EventType.ShouldBe("Booked");
        entry.Actor.ShouldBe("system"); // no HTTP request, so CurrentActor keeps its default
        entry.OccurredAtUtc.ShouldBe(TestData.Now);
        appointment.DomainEvents.ShouldBeEmpty("events are cleared once they are persisted");

        // Payload: the event's own fields, camelCase, with only the masked VIN (no customer PII reaches the audit trail).
        using var payload = JsonDocument.Parse(entry.Payload);
        payload.RootElement.GetProperty("appointmentId").GetGuid().ShouldBe(appointment.Id);
        payload.RootElement.GetProperty("bayId").GetGuid().ShouldBe(_workshop.Bay1.Id);
        payload.RootElement.GetProperty("startUtc").GetDateTime().ShouldBe(TestData.LondonTime(9));
        payload.RootElement.GetProperty("maskedVin").GetString().ShouldBe("***********123456");
        entry.Payload.ShouldNotContain("WVWZZZ1KZAW123456");
        entry.Payload.ShouldNotContain("customer1@example.com");

        // The history row commits or rolls back with the appointment: inside a transaction that is rolled back, neither survives.
        var rolledBack = _workshop.Book(TestData.LondonTime(11));
        await using (var db = NewContext(new CurrentActor(), new RecordingObserver()))
        {
            await using var transaction = await db.Database.BeginTransactionAsync(Ct);
            db.Appointments.Add(rolledBack);
            await db.SaveChangesAsync(Ct);
            (await db.AppointmentHistory.CountAsync(h => h.AppointmentId == rolledBack.Id, Ct)).ShouldBe(1);
            await transaction.RollbackAsync(Ct);
        }

        (await HistoryOfAsync(rolledBack.Id)).ShouldBeEmpty();
        (await _factory.WithDbAsync(db => db.Appointments.CountAsync(a => a.Id == rolledBack.Id, Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task Failed_save_writes_no_history()
    {
        var first = _workshop.Book(TestData.LondonTime(9));
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(first);
            await db.SaveChangesAsync(Ct);
        });

        // Same bay, overlapping: the exclusion constraint rejects the insert (23P01) and the whole save rolls back.
        var clash = _workshop.Book(TestData.LondonTime(9, 30), technician: _workshop.Technician2);
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(clash);
            var ex = await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
            PostgresErrorClassifier.Classify(ex).ShouldBe(PostgresFailure.BayOverlap);

            // The history entry staged for the failed save is not left behind in the change tracker ...
            db.ChangeTracker.Entries<AppointmentHistoryEntry>().ShouldBeEmpty();

            // ... and the aggregate keeps its event, so a corrected retry still audits it exactly once.
            clash.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<AppointmentBooked>();
        });

        (await HistoryOfAsync(clash.Id)).ShouldBeEmpty();
        (await HistoryOfAsync(first.Id)).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Actor_comes_from_the_scoped_current_actor()
    {
        var appointment = _workshop.Book(TestData.LondonTime(9));
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<CurrentActor>().Name = "anonymous:203.0.113.7";
            var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);

            var stored = await db.Appointments.SingleAsync(a => a.Id == appointment.Id, Ct);
            stored.Cancel("Customer rescheduled", TestData.Now.AddMinutes(5));
            await db.SaveChangesAsync(Ct);
        }

        var history = await HistoryOfAsync(appointment.Id);
        history.Select(h => h.EventType).ShouldBe(["Booked", "Cancelled"]);
        history.ShouldAllBe(h => h.Actor == "anonymous:203.0.113.7");

        using var cancelled = JsonDocument.Parse(history[1].Payload);
        cancelled.RootElement.GetProperty("previousStatus").GetString().ShouldBe("Confirmed"); // enums as strings
        cancelled.RootElement.GetProperty("reason").GetString().ShouldBe("Customer rescheduled");
    }

    [Fact]
    public async Task Observers_are_notified_only_after_commit()
    {
        var observer = new RecordingObserver();
        var actor = new CurrentActor { Name = "test" };

        // Implicit transaction: SaveChanges commits, then observers hear about it.
        var plain = _workshop.Book(TestData.LondonTime(9));
        await using (var db = NewContext(actor, observer))
        {
            db.Appointments.Add(plain);
            await db.SaveChangesAsync(Ct);
        }

        observer.Batches.ShouldHaveSingleItem().ShouldHaveSingleItem().ShouldBeOfType<AppointmentBooked>().AppointmentId.ShouldBe(plain.Id);

        // Explicit transaction: nothing is announced at SaveChanges, only when the transaction commits.
        var explicitCommit = _workshop.Book(TestData.LondonTime(10));
        await using (var db = NewContext(actor, observer))
        {
            await using var transaction = await db.Database.BeginTransactionAsync(Ct);
            db.Appointments.Add(explicitCommit);
            await db.SaveChangesAsync(Ct);
            observer.Batches.Count.ShouldBe(1);
            await transaction.CommitAsync(Ct);
        }

        observer.Batches.Count.ShouldBe(2);
        observer.Batches[1].ShouldHaveSingleItem().AppointmentId.ShouldBe(explicitCommit.Id);

        // Rolled back or failed: never announced.
        await using (var db = NewContext(actor, observer))
        {
            await using var transaction = await db.Database.BeginTransactionAsync(Ct);
            db.Appointments.Add(_workshop.Book(TestData.LondonTime(11)));
            await db.SaveChangesAsync(Ct);
            await transaction.RollbackAsync(Ct);
        }

        await using (var db = NewContext(actor, observer))
        {
            db.Appointments.Add(_workshop.Book(TestData.LondonTime(9, 30))); // overlaps `plain` on Bay 1 and Technician 1
            await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
        }

        observer.Batches.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Synchronous_save_audits_and_notifies_the_same_way()
    {
        var observer = new RecordingObserver();
        var appointment = _workshop.Book(TestData.LondonTime(9));
        using (var db = NewContext(new CurrentActor(), observer))
        {
            db.Appointments.Add(appointment);
            db.SaveChanges(); // the synchronous path is the subject of this test
        }

        (await HistoryOfAsync(appointment.Id)).ShouldHaveSingleItem().EventType.ShouldBe("Booked");
        observer.Batches.ShouldHaveSingleItem().ShouldHaveSingleItem().AppointmentId.ShouldBe(appointment.Id);
    }

    [Fact]
    public async Task Observer_failure_after_commit_is_logged_and_never_reaches_the_caller()
    {
        var logger = new CapturingLogger<DomainEventInterceptor>();
        var later = new RecordingObserver();
        IDomainEventObserver[] observers =
        [
            new ThrowingObserver(new InvalidOperationException("observer bug")),
            new ThrowingObserver(new OperationCanceledException()),
            later,
        ];

        // Implicit transaction (async), explicit transaction commit, and the synchronous path: each commits and audits although
        // two observers throw, and the observer after them is still told.
        var implicitSave = _workshop.Book(TestData.LondonTime(9));
        await using (var db = NewContext(new CurrentActor(), observers, logger))
        {
            db.Appointments.Add(implicitSave);
            (await db.SaveChangesAsync(Ct)).ShouldBeGreaterThan(0);
        }

        var explicitCommit = _workshop.Book(TestData.LondonTime(10));
        await using (var db = NewContext(new CurrentActor(), observers, logger))
        {
            await using var transaction = await db.Database.BeginTransactionAsync(Ct);
            db.Appointments.Add(explicitCommit);
            await db.SaveChangesAsync(Ct);
            await transaction.CommitAsync(Ct);
        }

        var synchronousSave = _workshop.Book(TestData.LondonTime(11));
        using (var db = NewContext(new CurrentActor(), observers, logger))
        {
            db.Appointments.Add(synchronousSave);
            db.SaveChanges(); // the synchronous path is part of the subject
        }

        foreach (var appointment in new[] { implicitSave, explicitCommit, synchronousSave })
        {
            (await HistoryOfAsync(appointment.Id)).ShouldHaveSingleItem().EventType.ShouldBe("Booked");
            (await _factory.WithDbAsync(db => db.Appointments.CountAsync(a => a.Id == appointment.Id, Ct))).ShouldBe(1);
        }

        later.Batches.Select(batch => batch.ShouldHaveSingleItem().AppointmentId)
            .ShouldBe([implicitSave.Id, explicitCommit.Id, synchronousSave.Id]);

        var failures = logger.Entries.Where(e => e.EventId.Id == 1005).ToList();
        failures.Count.ShouldBe(6, "two failing observers on each of three commits");
        failures.ShouldAllBe(e => e.Level == LogLevel.Error && e.EventId.Name == "DomainEventObserverFailed");
        failures.ShouldAllBe(e => e.Message.Contains(nameof(ThrowingObserver)) && e.Message.Contains("Booked"));
        failures.Select(e => e.Exception).OfType<InvalidOperationException>().Count().ShouldBe(3);
        failures.Select(e => e.Exception).OfType<OperationCanceledException>().Count().ShouldBe(3);
    }

    private SchedulerDbContext NewContext(CurrentActor actor, IDomainEventObserver observer) =>
        NewContext(actor, [observer], NullLogger<DomainEventInterceptor>.Instance);

    private SchedulerDbContext NewContext(CurrentActor actor, IEnumerable<IDomainEventObserver> observers, ILogger<DomainEventInterceptor> logger) =>
        new(new DbContextOptionsBuilder<SchedulerDbContext>()
            .UseNpgsql(pg.ConnectionString)
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(new DomainEventInterceptor(actor, observers, logger))
            .Options);

    private Task<List<AppointmentHistoryEntry>> HistoryOfAsync(Guid appointmentId) =>
        _factory.WithDbAsync(db => db.AppointmentHistory.AsNoTracking()
            .Where(h => h.AppointmentId == appointmentId)
            .OrderBy(h => h.OccurredAtUtc)
            .ToListAsync(Ct));

    private sealed class ThrowingObserver(Exception exception) : IDomainEventObserver
    {
        public Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct) => Task.FromException(exception);
    }

    private sealed class RecordingObserver : IDomainEventObserver
    {
        public List<IReadOnlyList<IDomainEvent>> Batches { get; } = [];

        public Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct)
        {
            Batches.Add(events);
            return Task.CompletedTask;
        }
    }
}

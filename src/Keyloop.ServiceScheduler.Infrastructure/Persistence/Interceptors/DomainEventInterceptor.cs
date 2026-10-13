using System.Data.Common;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Stages <c>appointment_history</c> and <c>notification_outbox</c> rows during <c>SaveChanges</c> and notifies
/// <see cref="IDomainEventObserver"/>s after the transaction commits.
/// </summary>
public sealed class DomainEventInterceptor(CurrentActor actor, IEnumerable<IDomainEventObserver> observers, ILogger<DomainEventInterceptor> logger)
    : SaveChangesInterceptor, IDbTransactionInterceptor
{
    // TransactionErrorEventData.Action for a failed commit (EF Core's RelationalTransaction).
    private const string CommitAction = "Commit";

    private readonly CurrentActor _actor = actor ?? throw new ArgumentNullException(nameof(actor));
    private readonly IDomainEventObserver[] _observers = observers?.ToArray() ?? throw new ArgumentNullException(nameof(observers));
    private readonly ILogger<DomainEventInterceptor> _logger = logger ?? throw new ArgumentNullException(nameof(logger));

    // Saved inside an explicit transaction that has not committed yet.
    private readonly AfterCommit _awaitingCommit = new();

    // Saved inside an explicit transaction whose commit reported a failure: committed or not, the caller has to find out.
    private readonly AfterCommit _inDoubt = new();

    // The SaveChanges in flight: its aggregates, their events and the history and outbox rows staged for them.
    private Staged? _staged;

    /// <summary>
    /// Settles the events of a commit that reported a failure: notifies the observers when <paramref name="committed"/> (the change is
    /// in the database after all), drops them otherwise. Does nothing when no commit is in doubt.
    /// </summary>
    public async Task ResolveInDoubtCommitAsync(bool committed, CancellationToken cancellationToken)
    {
        if (_inDoubt.IsEmpty)
        {
            return;
        }

        var report = _inDoubt.Take();
        if (committed)
        {
            await NotifyAsync(report, cancellationToken);
        }
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stage(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Stage(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        if (Complete() is { } committed)
        {
            NotifyAsync(committed, CancellationToken.None).GetAwaiter().GetResult();
        }

        return result;
    }

    public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        if (Complete() is { } committed)
        {
            await NotifyAsync(committed, cancellationToken);
        }

        return result;
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData) => Discard(eventData.Context);

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Discard(eventData.Context);
        return Task.CompletedTask;
    }

    public override void SaveChangesCanceled(DbContextEventData eventData) => Discard(eventData.Context);

    public override Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default)
    {
        Discard(eventData.Context);
        return Task.CompletedTask;
    }

    // A new transaction means any events still awaiting a commit belonged to one that ended without committing (e.g. disposed).
    public DbTransaction TransactionStarted(DbConnection connection, TransactionEndEventData eventData, DbTransaction result)
    {
        _awaitingCommit.Clear();
        return result;
    }

    public ValueTask<DbTransaction> TransactionStartedAsync(
        DbConnection connection, TransactionEndEventData eventData, DbTransaction result, CancellationToken cancellationToken = default)
    {
        _awaitingCommit.Clear();
        return ValueTask.FromResult(result);
    }

    public void TransactionCommitted(DbTransaction transaction, TransactionEndEventData eventData)
    {
        if (TakeAwaitingCommit() is { } committed)
        {
            NotifyAsync(committed, CancellationToken.None).GetAwaiter().GetResult();
        }
    }

    public async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        if (TakeAwaitingCommit() is { } committed)
        {
            await NotifyAsync(committed, cancellationToken);
        }
    }

    public void TransactionRolledBack(DbTransaction transaction, TransactionEndEventData eventData) => _awaitingCommit.Clear();

    public Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        _awaitingCommit.Clear();
        return Task.CompletedTask;
    }

    public void TransactionFailed(DbTransaction transaction, TransactionErrorEventData eventData) => OnTransactionFailed(eventData);

    public Task TransactionFailedAsync(DbTransaction transaction, TransactionErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        OnTransactionFailed(eventData);
        return Task.CompletedTask;
    }

    // A failed commit may have committed on the server; any other failed transaction operation (a rollback, a savepoint) did not commit.
    private void OnTransactionFailed(TransactionErrorEventData eventData)
    {
        var report = _awaitingCommit.Take();
        if (string.Equals(eventData.Action, CommitAction, StringComparison.Ordinal))
        {
            _inDoubt.Add(report);
        }
    }

    private void Stage(DbContext? context)
    {
        _staged = null;
        if (context is null)
        {
            return;
        }

        var aggregates = context.ChangeTracker.Entries<AggregateRoot>()
            .Select(entry => entry.Entity)
            .Where(aggregate => aggregate.DomainEvents.Count > 0)
            .ToList();
        if (aggregates.Count == 0)
        {
            return;
        }

        // Every row is built before the context is touched, so a fault here leaves nothing staged and a retry writes each row once.
        var events = aggregates.SelectMany(aggregate => aggregate.DomainEvents).ToList();
        var entries = events.Select(domainEvent => AppointmentHistoryEntry.From(domainEvent, _actor.Name)).ToList();
        var notifications = Notifications(aggregates);
        context.Set<AppointmentHistoryEntry>().AddRange(entries);
        context.Set<NotificationOutboxEntry>().AddRange(notifications);

        // Decided before EF opens its own transaction for this save: only a caller's transaction defers the notification.
        _staged = new Staged(aggregates, events, entries, notifications, InCallerTransaction: context.Database.CurrentTransaction is not null);
    }

    /// <summary>The events and suppressed outbox rows of a save, to report once the save's transaction has committed.</summary>
    private static AfterCommit Report(Staged staged)
    {
        var report = new AfterCommit();
        report.Add(staged.Events, staged.Notifications.Where(n => n.Status == NotificationStatus.Suppressed));
        return report;
    }

    /// <summary>
    /// Stages booking confirmation and cancellation outbox entries in the same <c>SaveChanges</c> call.
    /// </summary>
    private static List<NotificationOutboxEntry> Notifications(List<AggregateRoot> aggregates)
    {
        var notifications = new List<NotificationOutboxEntry>();
        foreach (var appointment in aggregates.OfType<Appointment>())
        {
            foreach (var domainEvent in appointment.DomainEvents)
            {
                NotificationKind? kind = domainEvent switch
                {
                    AppointmentBooked => NotificationKind.BookingConfirmation,
                    AppointmentCancelled => NotificationKind.Cancellation,
                    _ => null,
                };
                if (kind is { } notificationKind)
                {
                    notifications.Add(NotificationOutboxEntry.Create(
                        notificationKind, appointment.Customer.Email, NotificationSnapshot.From(appointment), domainEvent.OccurredAtUtc));
                }
            }
        }

        return notifications;
    }

    /// <summary>What the save reports if it is committed now; null when there is nothing or it awaits an explicit transaction's commit.</summary>
    private AfterCommit? Complete()
    {
        var staged = _staged;
        _staged = null;
        if (staged is null)
        {
            return null;
        }

        foreach (var aggregate in staged.Aggregates)
        {
            aggregate.ClearDomainEvents();
        }

        if (staged.InCallerTransaction)
        {
            _awaitingCommit.Add(Report(staged));
            return null;
        }

        return Report(staged);
    }

    private void Discard(DbContext? context)
    {
        var staged = _staged;
        _staged = null;
        if (staged is null || context is null)
        {
            return;
        }

        foreach (var notification in staged.Notifications)
        {
            context.Entry(notification).State = EntityState.Detached;
        }

        foreach (var entry in staged.Entries)
        {
            context.Entry(entry).State = EntityState.Detached;
        }
    }

    private AfterCommit? TakeAwaitingCommit() => _awaitingCommit.IsEmpty ? null : _awaitingCommit.Take();

    private async Task NotifyAsync(AfterCommit committed, CancellationToken cancellationToken)
    {
        var eventTypes = string.Join(", ", committed.Events.Select(e => e.EventType).Distinct());

        // Each step is isolated, so one failure neither reaches the caller nor silences the steps after it.
        try
        {
            RecordSuppressed(committed.Suppressed);
        }
#pragma warning disable CA1031 // Deliberately broad: nothing reported after the commit may surface to the caller.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            _logger.DomainEventObserverFailed(ex, nameof(InfrastructureTelemetry.NotificationsSuppressed), eventTypes);
        }

        foreach (var observer in _observers)
        {
            try
            {
                await observer.OnCommittedAsync(committed.Events, cancellationToken);
            }
#pragma warning disable CA1031 // Deliberately broad: nothing an observer throws after the commit may surface to the caller.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                _logger.DomainEventObserverFailed(ex, observer.GetType().Name, eventTypes);
            }
        }
    }

    /// <summary>
    /// Counts and logs committed outbox rows that were suppressed by the recipient policy when staged.
    /// </summary>
    private void RecordSuppressed(IReadOnlyList<NotificationOutboxEntry> suppressed)
    {
        foreach (var row in suppressed)
        {
            var kind = row.Kind.ToString();
            var reason = row.LastFailure!; // Suppress always records the reason
            InfrastructureTelemetry.NotificationsSuppressed.Add(
                1, new KeyValuePair<string, object?>("kind", kind), new KeyValuePair<string, object?>("reason", reason));
            _logger.NotificationSuppressed(row.Id, row.AppointmentId, kind, reason);
        }
    }

    private sealed record Staged(
        List<AggregateRoot> Aggregates, List<IDomainEvent> Events, List<AppointmentHistoryEntry> Entries,
        List<NotificationOutboxEntry> Notifications, bool InCallerTransaction);

    /// <summary>What saved changes report once committed: their events to the observers, and their suppressed outbox rows.</summary>
    private sealed class AfterCommit
    {
        private readonly List<IDomainEvent> _events = [];
        private readonly List<NotificationOutboxEntry> _suppressed = [];

        public IReadOnlyList<IDomainEvent> Events => _events;

        public IReadOnlyList<NotificationOutboxEntry> Suppressed => _suppressed;

        public bool IsEmpty => _events.Count == 0 && _suppressed.Count == 0;

        public void Add(IEnumerable<IDomainEvent> events, IEnumerable<NotificationOutboxEntry> suppressed)
        {
            _events.AddRange(events);
            _suppressed.AddRange(suppressed);
        }

        public void Add(AfterCommit other) => Add(other._events, other._suppressed);

        public void Clear()
        {
            _events.Clear();
            _suppressed.Clear();
        }

        /// <summary>Moves the contents into a new instance, leaving this one empty.</summary>
        public AfterCommit Take()
        {
            var taken = new AfterCommit();
            taken.Add(this);
            Clear();
            return taken;
        }
    }
}

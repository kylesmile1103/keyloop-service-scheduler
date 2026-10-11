using System.Data.Common;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Turns the domain events of saved aggregates into <c>appointment_history</c> rows inside the same SaveChanges (so the audit row
/// commits or rolls back with the change), and tells <see cref="IDomainEventObserver"/>s about the events only after the
/// transaction has committed (SYSTEM_DESIGN §5.6).
/// </summary>
/// <remarks>
/// One instance per DbContext (both are scoped). When SaveChanges runs in its own transaction, observers are notified as soon as it
/// returns; inside an explicit transaction they are notified when that transaction commits, and never if it rolls back. A failed
/// SaveChanges detaches the staged history rows and leaves the aggregates' events in place, so a retry audits them exactly once.
/// An observer that throws (cancellation included) is logged as event 1005 and never rethrown: the change is already committed, so
/// the caller must not see a failure, and a retrying execution strategy must not re-run the unit of work.
/// </remarks>
public sealed class DomainEventInterceptor(CurrentActor actor, IEnumerable<IDomainEventObserver> observers, ILogger<DomainEventInterceptor> logger)
    : SaveChangesInterceptor, IDbTransactionInterceptor
{
    private readonly CurrentActor _actor = actor ?? throw new ArgumentNullException(nameof(actor));
    private readonly IDomainEventObserver[] _observers = observers?.ToArray() ?? throw new ArgumentNullException(nameof(observers));
    private readonly ILogger<DomainEventInterceptor> _logger = logger ?? throw new ArgumentNullException(nameof(logger));

    // Events saved inside an explicit transaction that has not committed yet.
    private readonly List<IDomainEvent> _awaitingCommit = [];

    // The SaveChanges in flight: its aggregates, their events and the history rows staged for them.
    private Staged? _staged;

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

    public void TransactionFailed(DbTransaction transaction, TransactionErrorEventData eventData) => _awaitingCommit.Clear();

    public Task TransactionFailedAsync(DbTransaction transaction, TransactionErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        _awaitingCommit.Clear();
        return Task.CompletedTask;
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

        var events = aggregates.SelectMany(aggregate => aggregate.DomainEvents).ToList();
        var entries = events.Select(domainEvent => AppointmentHistoryEntry.From(domainEvent, _actor.Name)).ToList();
        context.Set<AppointmentHistoryEntry>().AddRange(entries);

        // Decided before EF opens its own transaction for this save: only a caller's transaction defers the notification.
        _staged = new Staged(aggregates, events, entries, InCallerTransaction: context.Database.CurrentTransaction is not null);
    }

    /// <summary>The saved events if they are committed now; null when there are none or they await an explicit transaction's commit.</summary>
    private IDomainEvent[]? Complete()
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
            _awaitingCommit.AddRange(staged.Events);
            return null;
        }

        return [.. staged.Events];
    }

    private void Discard(DbContext? context)
    {
        var staged = _staged;
        _staged = null;
        if (staged is null || context is null)
        {
            return;
        }

        foreach (var entry in staged.Entries)
        {
            context.Entry(entry).State = EntityState.Detached;
        }
    }

    private IDomainEvent[]? TakeAwaitingCommit()
    {
        if (_awaitingCommit.Count == 0)
        {
            return null;
        }

        IDomainEvent[] committed = [.. _awaitingCommit];
        _awaitingCommit.Clear();
        return committed;
    }

    private async Task NotifyAsync(IReadOnlyList<IDomainEvent> committed, CancellationToken cancellationToken)
    {
        // Each observer is isolated, so one failure neither reaches the caller nor silences the observers after it.
        foreach (var observer in _observers)
        {
            try
            {
                await observer.OnCommittedAsync(committed, cancellationToken);
            }
#pragma warning disable CA1031 // Deliberately broad: nothing an observer throws after the commit may surface to the caller.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                _logger.DomainEventObserverFailed(ex, observer.GetType().Name, string.Join(", ", committed.Select(e => e.EventType).Distinct()));
            }
        }
    }

    private sealed record Staged(
        List<AggregateRoot> Aggregates, List<IDomainEvent> Events, List<AppointmentHistoryEntry> Entries, bool InCallerTransaction);
}

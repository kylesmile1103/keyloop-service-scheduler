using System.Threading.Channels;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Wakes this instance's dispatcher when a booking or cancellation commits, so its email leaves at once without polling. A nudge that
/// arrives while the dispatcher is busy is kept (capacity one) and costs one more cycle, so none is lost. Best effort by design: a commit
/// whose events are never observed (an unresolved in-doubt commit, another instance) is picked up at the next due time or idle wake.
/// </summary>
public sealed class NotificationSignal
{
    private readonly Channel<bool> _nudges = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

    public void Nudge() => _nudges.Writer.TryWrite(true);

    /// <summary>Forgets a pending nudge; the cycle about to run will see the work it announced.</summary>
    internal void Reset() => _nudges.Reader.TryRead(out _);

    /// <summary>Returns at the first nudge or once <paramref name="timeout"/> has passed on <paramref name="timeProvider"/>.</summary>
    internal async Task WaitAsync(TimeSpan timeout, TimeProvider timeProvider, CancellationToken cancellationToken)
    {
        using var wake = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var nudged = _nudges.Reader.WaitToReadAsync(wake.Token).AsTask();
        var due = Task.Delay(timeout < TimeSpan.Zero ? TimeSpan.Zero : timeout, timeProvider, wake.Token);
        await Task.WhenAny(nudged, due);
        await wake.CancelAsync(); // the other wait ends cancelled, which is never an unobserved exception
        cancellationToken.ThrowIfCancellationRequested();
    }
}

/// <summary>Nudges the dispatcher after a booking or cancellation has committed (the outbox row is then durable).</summary>
public sealed class NotificationNudgeObserver(NotificationSignal signal) : IDomainEventObserver
{
    public Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (events.Any(e => e is AppointmentBooked or AppointmentCancelled))
        {
            signal.Nudge();
        }
        return Task.CompletedTask;
    }
}

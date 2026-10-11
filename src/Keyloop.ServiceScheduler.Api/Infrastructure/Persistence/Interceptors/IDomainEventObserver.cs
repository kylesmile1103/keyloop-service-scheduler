using Keyloop.ServiceScheduler.Api.Domain.Common;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Hears about domain events once the transaction that persisted them has committed (telemetry, logs; later an outbox).
/// Called on the request path after the commit: an exception propagates to the caller although the data is already saved,
/// so implementations must not throw for anything but a programming error.
/// </summary>
public interface IDomainEventObserver
{
    Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct);
}

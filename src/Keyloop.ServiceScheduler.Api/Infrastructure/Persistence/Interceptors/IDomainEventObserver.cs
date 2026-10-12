using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Hears about domain events once the transaction that persisted them has committed (telemetry, logs; later an outbox).
/// Called on the request path after the commit. <see cref="DomainEventInterceptor"/> catches and logs anything an observer throws
/// (event 1005 DomainEventObserverFailed) because the data is already saved; a throw is still a bug, not a way to signal failure.
/// </summary>
public interface IDomainEventObserver
{
    Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct);
}

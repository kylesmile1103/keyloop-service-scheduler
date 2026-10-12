using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.Infrastructure.Telemetry;

/// <summary>The shared service meter and persistence/outbound instruments. Names, units and kinds are stable (ARCHITECTURE §12.1).</summary>
public static class InfrastructureTelemetry
{
    public const string Name = "Keyloop.ServiceScheduler";

    public static readonly Meter Meter = new(Name);

    // Notification instruments (ARCHITECTURE §12.1) carry no recipient or other PII: tags are the kind and a fixed reason only.

    /// <summary>Tags: <c>kind</c>. Accepted by the sender (not proof of inbox delivery).</summary>
    internal static readonly Counter<long> NotificationsSent = Meter.CreateCounter<long>("scheduler.notifications.sent", "{notification}");

    /// <summary>Tags: <c>kind</c>. Dead letters: attempts exhausted, an expired lease at the limit, or an email that cannot be rendered.</summary>
    internal static readonly Counter<long> NotificationsFailed = Meter.CreateCounter<long>("scheduler.notifications.failed", "{notification}");

    /// <summary>Tags: <c>kind</c>.</summary>
    internal static readonly Counter<long> NotificationsRetried = Meter.CreateCounter<long>("scheduler.notifications.retried", "{notification}");

    /// <summary>Tags: <c>kind</c>. One send attempt, measured with <c>Stopwatch</c>.</summary>
    internal static readonly Histogram<double> NotificationDispatchDuration = Meter.CreateHistogram<double>("scheduler.notifications.dispatch_duration", "ms");

    /// <summary>Tags: <c>kind</c>. The row's age at each send attempt, on the business clock.</summary>
    internal static readonly Histogram<double> NotificationOutboxAge = Meter.CreateHistogram<double>("scheduler.notifications.outbox_age", "s");

    /// <summary>
    /// Tags: <c>kind</c>, <c>reason</c> (<c>ReservedDomain</c>; Task 20 adds the configurable policy's reasons). Never sent. Counted once a
    /// row staged Suppressed has committed (DomainEventInterceptor), or when the dispatcher suppresses a Pending row at claim.
    /// </summary>
    internal static readonly Counter<long> NotificationsSuppressed = Meter.CreateCounter<long>("scheduler.notifications.suppressed", "{notification}");

    /// <summary>
    /// Tags: <c>kind</c>. Pending rows (leased ones included) whether or not dispatch is enabled, so a disabled or stalled dispatcher is
    /// visible as a backlog. Read from the database by <see cref="NotificationBacklogMonitor"/>, cached for the export interval.
    /// </summary>
    internal static readonly ObservableGauge<long> NotificationsOutboxPending = Meter.CreateObservableGauge(
        "scheduler.notifications.outbox_pending", NotificationBacklogMonitor.ObservePending, "{notification}");

    /// <summary>The age of the oldest Pending row (0 when there is none), from the same cached query.</summary>
    internal static readonly ObservableGauge<double> NotificationsOldestPendingAge = Meter.CreateObservableGauge(
        "scheduler.notifications.oldest_pending_age", NotificationBacklogMonitor.ObserveOldestPendingAge, "s");
}

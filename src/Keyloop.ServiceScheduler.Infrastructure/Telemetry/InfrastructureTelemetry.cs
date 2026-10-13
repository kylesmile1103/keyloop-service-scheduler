using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.Infrastructure.Telemetry;

/// <summary>The shared service meter and persistence/outbound instruments.</summary>
public static class InfrastructureTelemetry
{
    public const string Name = "Keyloop.ServiceScheduler";

    public static readonly Meter Meter = new(Name);

    // Notification instruments carry no recipient or other PII: tags are the kind and a fixed reason only.

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
    /// Tags: <c>kind</c>, <c>reason</c>. Counted once a suppressed row commits or when the dispatcher suppresses a Pending row at claim.
    /// </summary>
    internal static readonly Counter<long> NotificationsSuppressed = Meter.CreateCounter<long>("scheduler.notifications.suppressed", "{notification}");

    /// <summary>
    /// Tags: <c>kind</c>. Pending rows (including leased) cached for the export interval by <see cref="NotificationBacklogMonitor"/>.
    /// </summary>
    internal static readonly ObservableGauge<long> NotificationsOutboxPending = Meter.CreateObservableGauge(
        "scheduler.notifications.outbox_pending", NotificationBacklogMonitor.ObservePending, "{notification}");

    /// <summary>The age of the oldest Pending row (0 when there is none), from the same cached query.</summary>
    internal static readonly ObservableGauge<double> NotificationsOldestPendingAge = Meter.CreateObservableGauge(
        "scheduler.notifications.oldest_pending_age", NotificationBacklogMonitor.ObserveOldestPendingAge, "s");
}

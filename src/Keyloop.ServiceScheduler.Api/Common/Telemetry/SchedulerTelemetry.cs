using System.Diagnostics;
using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// The service's traces and metrics (SYSTEM_DESIGN §12.1). ServiceDefaults subscribes to <see cref="Name"/>. The instrument names,
/// units and kinds are part of the design (dashboards and alerts depend on them): do not rename.
/// </summary>
public static class SchedulerTelemetry
{
    public const string Name = "Keyloop.ServiceScheduler";

    public static readonly ActivitySource Source = new(Name);

    public static readonly Meter Meter = new(Name);

    /// <summary>Tags: <c>outcome</c>, <c>dealership.id</c>.</summary>
    public static readonly Counter<long> BookingRequests = Meter.CreateCounter<long>("scheduler.booking.requests", "{request}");

    /// <summary>Tags: <c>outcome</c>.</summary>
    public static readonly Histogram<double> BookingDuration = Meter.CreateHistogram<double>("scheduler.booking.duration", "ms");

    /// <summary>Tags: <c>dealership.id</c>.</summary>
    public static readonly Histogram<double> LockWait = Meter.CreateHistogram<double>("scheduler.booking.lock_wait", "ms");

    /// <summary>Tags: <c>constraint</c>. Should stay at 0; non-zero means an out-of-band writer.</summary>
    public static readonly Counter<long> ConstraintBackstop = Meter.CreateCounter<long>("scheduler.booking.constraint_backstop", "{event}");

    /// <summary>Must stay at 0.</summary>
    public static readonly Counter<long> Deadlocks = Meter.CreateCounter<long>("scheduler.booking.deadlocks", "{event}");

    /// <summary>Tags: <c>dealership.id</c>.</summary>
    public static readonly Histogram<double> AvailabilityDuration = Meter.CreateHistogram<double>("scheduler.availability.duration", "ms");

    public static readonly Histogram<long> AvailabilitySlotsReturned = Meter.CreateHistogram<long>("scheduler.availability.slots_returned", "{slot}");

    /// <summary>Tags: <c>previous_status</c>.</summary>
    public static readonly Counter<long> Cancellations = Meter.CreateCounter<long>("scheduler.appointments.cancellations", "{appointment}");

    // Notification instruments (SYSTEM_DESIGN §12.1) carry no recipient or other PII: tags are the kind and a fixed reason only.

    /// <summary>Tags: <c>kind</c>. Accepted by the sender (not proof of inbox delivery).</summary>
    public static readonly Counter<long> NotificationsSent = Meter.CreateCounter<long>("scheduler.notifications.sent", "{notification}");

    /// <summary>Tags: <c>kind</c>. Dead letters: attempts exhausted, an expired lease at the limit, or an email that cannot be rendered.</summary>
    public static readonly Counter<long> NotificationsFailed = Meter.CreateCounter<long>("scheduler.notifications.failed", "{notification}");

    /// <summary>Tags: <c>kind</c>.</summary>
    public static readonly Counter<long> NotificationsRetried = Meter.CreateCounter<long>("scheduler.notifications.retried", "{notification}");

    /// <summary>Tags: <c>kind</c>. One send attempt, measured with <c>Stopwatch</c>.</summary>
    public static readonly Histogram<double> NotificationDispatchDuration = Meter.CreateHistogram<double>("scheduler.notifications.dispatch_duration", "ms");

    /// <summary>Tags: <c>kind</c>. The row's age at each send attempt, on the business clock.</summary>
    public static readonly Histogram<double> NotificationOutboxAge = Meter.CreateHistogram<double>("scheduler.notifications.outbox_age", "s");

    /// <summary>
    /// Tags: <c>kind</c>, <c>reason</c> (<c>ReservedDomain</c>; Task 20 adds the configurable policy's reasons). Never sent. Counted once a
    /// row staged Suppressed has committed (DomainEventInterceptor), or when the dispatcher suppresses a Pending row at claim.
    /// </summary>
    public static readonly Counter<long> NotificationsSuppressed = Meter.CreateCounter<long>("scheduler.notifications.suppressed", "{notification}");

    /// <summary>
    /// Tags: <c>kind</c>. Pending rows (leased ones included) whether or not dispatch is enabled, so a disabled or stalled dispatcher is
    /// visible as a backlog. Read from the database by <see cref="NotificationBacklogMonitor"/>, cached for the export interval.
    /// </summary>
    public static readonly ObservableGauge<long> NotificationsOutboxPending = Meter.CreateObservableGauge(
        "scheduler.notifications.outbox_pending", NotificationBacklogMonitor.ObservePending, "{notification}");

    /// <summary>The age of the oldest Pending row (0 when there is none), from the same cached query.</summary>
    public static readonly ObservableGauge<double> NotificationsOldestPendingAge = Meter.CreateObservableGauge(
        "scheduler.notifications.oldest_pending_age", NotificationBacklogMonitor.ObserveOldestPendingAge, "s");
}

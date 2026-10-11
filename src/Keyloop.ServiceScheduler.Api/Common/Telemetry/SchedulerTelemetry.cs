using System.Diagnostics;
using System.Diagnostics.Metrics;

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
    /// <summary>Notification instruments are tagged by kind only; no recipient or other PII.</summary>
    public static readonly Counter<long> NotificationsSent = Meter.CreateCounter<long>("scheduler.notifications.sent", "{notification}");
    public static readonly Counter<long> NotificationsFailed = Meter.CreateCounter<long>("scheduler.notifications.failed", "{notification}");
    public static readonly Counter<long> NotificationsRetried = Meter.CreateCounter<long>("scheduler.notifications.retried", "{notification}");
    public static readonly Histogram<double> NotificationDispatchDuration = Meter.CreateHistogram<double>("scheduler.notifications.dispatch_duration", "ms");
    public static readonly Histogram<double> NotificationOutboxAge = Meter.CreateHistogram<double>("scheduler.notifications.outbox_age", "s");
}

using System.Diagnostics.Metrics;
using System.Diagnostics;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>Request traces and instruments, using the shared service meter (SYSTEM_DESIGN §12.1).</summary>
public static class SchedulerTelemetry
{
    public const string Name = InfrastructureTelemetry.Name;

    public static readonly ActivitySource Source = new(Name);

    public static readonly Meter Meter = InfrastructureTelemetry.Meter;

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
}

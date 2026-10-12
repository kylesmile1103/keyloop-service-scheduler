using System.Diagnostics.Metrics;
using System.Diagnostics;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>Request traces and instruments, using the shared service meter (ARCHITECTURE §12.1).</summary>
public static class SchedulerTelemetry
{
    public const string Name = InfrastructureTelemetry.Name;

    public static readonly ActivitySource Source = new(Name);

    public static readonly Meter Meter = InfrastructureTelemetry.Meter;

    public static readonly Counter<long> AllocationDecidedBy = Meter.CreateCounter<long>("scheduler.allocation.decided_by", "{allocation}");
    public static readonly Counter<long> RequirementRuleFired = Meter.CreateCounter<long>("scheduler.requirements.rule_fired", "{rule}");
    public static readonly Counter<long> ProfileSource = Meter.CreateCounter<long>("scheduler.intake.profile_source", "{profile}");
    public static readonly Counter<long> AllocationBelowHvMinimum = Meter.CreateCounter<long>("scheduler.allocation.below_hv_minimum", "{event}");

    /// <summary>Tags: outcome, and reason when unavailable. Never customer text.</summary>
    public static readonly Counter<long> TriageRequests = Meter.CreateCounter<long>("scheduler.triage.requests", "{request}");
    public static readonly Histogram<double> TriageDuration = Meter.CreateHistogram<double>("scheduler.triage.duration", "s");

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

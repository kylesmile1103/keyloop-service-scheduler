using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>Outcome of a single booking transaction attempt.</summary>
public abstract record BookingAttempt
{
    private BookingAttempt()
    {
    }

    /// <summary>The appointment, its history row, and any memoised idempotency response committed.</summary>
    public sealed record Confirmed(Appointment Appointment, ServiceBay Bay, Technician Technician) : BookingAttempt;

    /// <summary>All qualified bays or technicians were busy during the locked pre-check (409 <c>slot-unavailable</c>).</summary>
    public sealed record Unavailable() : BookingAttempt;

    /// <summary>The database rejected the insert due to an exclusion constraint or deadlock (409 <c>slot-conflict</c>).</summary>
    public sealed record Conflict(string Resource) : BookingAttempt;

    /// <summary>The idempotency key primary key constraint rejected the insert.</summary>
    public sealed record DuplicateKey() : BookingAttempt;

    /// <summary>A live idempotency key row already existed when checked under the dealership lock.</summary>
    public sealed record KeyInUse(IdempotencyKey Stored) : BookingAttempt;

    /// <summary>A newer requirement policy version was published before the dealership lock was acquired.</summary>
    public sealed record PolicyChanged() : BookingAttempt;
}

/// <summary>Outcome tag values for booking metrics and trace spans.</summary>
public static class BookingOutcomes
{
    public const string Confirmed = "confirmed";
    public const string Replayed = "replayed";
    public const string SlotUnavailable = "slot_unavailable";
    public const string SlotConflict = "slot_conflict";
    public const string ConcurrencyConflict = "concurrency_conflict";
    public const string RuleViolation = "rule_violation";
    public const string NotFound = "not_found";
    public const string IdempotencyReuse = "idempotency_reuse";
    public const string ValidationFailed = "validation_failed";

    /// <summary>An unexpected failure (a 500); not a rejection.</summary>
    public const string Error = "error";

    /// <summary>The outcomes that are refusals of a well-formed or malformed request, logged as 1002 BookingRejected.</summary>
    public static bool IsRejection(string outcome) =>
        outcome is SlotUnavailable or SlotConflict or ConcurrencyConflict or RuleViolation or NotFound or IdempotencyReuse or ValidationFailed;
}

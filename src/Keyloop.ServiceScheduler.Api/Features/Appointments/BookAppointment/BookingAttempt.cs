using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// How one run of the booking transaction ended. The execution strategy may run it more than once (a transient failure), so the
/// transaction returns a value instead of throwing, and the handler turns the final value into the response outside it.
/// </summary>
public abstract record BookingAttempt
{
    private BookingAttempt()
    {
    }

    /// <summary>Committed: the appointment, its history row and (with a key) the memoised response.</summary>
    public sealed record Confirmed(Appointment Appointment, ServiceBay Bay, Technician Technician) : BookingAttempt;

    /// <summary>The locked pre-check found every qualified bay or every qualified technician busy (409 <c>slot-unavailable</c>).</summary>
    public sealed record Unavailable() : BookingAttempt;

    /// <summary>
    /// The database refused the insert although the pre-check passed (409 <c>slot-conflict</c>): an exclusion constraint fired
    /// (<see cref="Resource"/> <c>bay</c> or <c>technician</c>), or, against ADR-003, a deadlock was broken (<c>unknown</c>).
    /// </summary>
    public sealed record Conflict(string Resource) : BookingAttempt;

    /// <summary>The key's primary key refused the insert: the same key committed meanwhile at another dealership (whose lock is not ours).</summary>
    public sealed record DuplicateKey() : BookingAttempt;

    /// <summary>Under the lock, the key turned out to be in use already (a concurrent request with it committed while this one waited).</summary>
    public sealed record KeyInUse(IdempotencyKey Stored) : BookingAttempt;

    /// <summary>
    /// Under the lock, the dealership's latest requirement policy is newer than the version resolved before it (an Admin published while
    /// this booking waited). Rolled back; the request resolves the new version and its qualified roster again (ADR-029 Task 30a amendment).
    /// </summary>
    public sealed record PolicyChanged() : BookingAttempt;
}

/// <summary>The <c>outcome</c> tag of <c>scheduler.booking.requests</c> and <c>scheduler.booking.duration</c>, and of the <c>booking.outcome</c> span tag (ARCHITECTURE §12.1).</summary>
public static class BookingOutcomes
{
    public const string Confirmed = "confirmed";
    public const string Replayed = "replayed";
    public const string SlotUnavailable = "slot_unavailable";
    public const string SlotConflict = "slot_conflict";
    public const string RuleViolation = "rule_violation";
    public const string NotFound = "not_found";
    public const string IdempotencyReuse = "idempotency_reuse";
    public const string ValidationFailed = "validation_failed";

    /// <summary>An unexpected failure (a 500); not a rejection.</summary>
    public const string Error = "error";

    /// <summary>The outcomes that are refusals of a well-formed or malformed request, logged as 1002 BookingRejected.</summary>
    public static bool IsRejection(string outcome) =>
        outcome is SlotUnavailable or SlotConflict or RuleViolation or NotFound or IdempotencyReuse or ValidationFailed;
}

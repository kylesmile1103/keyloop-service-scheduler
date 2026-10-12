using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// What a refused insert means for the booking (ARCHITECTURE §7.4): the attempt to answer with, and the telemetry the refusal owes.
/// <see cref="For"/> is pure; <see cref="Record"/> writes the telemetry. A failure that is not a refusal (<see langword="null"/>)
/// propagates to the execution strategy and, unless it is transient, to a 500.
/// </summary>
/// <param name="Attempt">The attempt the booking transaction returns (after rolling back).</param>
/// <param name="BackstopConstraint">The exclusion constraint that fired, counted on <c>scheduler.booking.constraint_backstop</c> and logged as 1003; null otherwise.</param>
/// <param name="Deadlock">PostgreSQL broke a deadlock (40P01), counted on <c>scheduler.booking.deadlocks</c> and logged as 1004.</param>
public sealed record BookingRefusal(BookingAttempt Attempt, string? BackstopConstraint, bool Deadlock)
{
    /// <summary>
    /// The refusal for <paramref name="failure"/>, or null when the booking transaction does not answer it. A 40P01 is answered here
    /// (409 <c>slot-conflict</c>, <c>unknown</c>) rather than retried: ADR-003 says it cannot happen, so it is reported, not hidden.
    /// </summary>
    public static BookingRefusal? For(PostgresFailure failure) => failure switch
    {
        PostgresFailure.BayOverlap => new BookingRefusal(new BookingAttempt.Conflict(ProblemResources.Bay), PostgresErrorClassifier.BayConstraint, Deadlock: false),
        PostgresFailure.TechnicianOverlap =>
            new BookingRefusal(new BookingAttempt.Conflict(ProblemResources.Technician), PostgresErrorClassifier.TechnicianConstraint, Deadlock: false),
        PostgresFailure.IdempotencyKeyDuplicate => new BookingRefusal(new BookingAttempt.DuplicateKey(), BackstopConstraint: null, Deadlock: false),
        PostgresFailure.Deadlock => new BookingRefusal(new BookingAttempt.Conflict(ProblemResources.Unknown), BackstopConstraint: null, Deadlock: true),
        _ => null,
    };

    /// <summary>Writes the telemetry this refusal owes (none for a duplicate idempotency key, which is a client's reuse, not an anomaly).</summary>
    public void Record(Exception exception, Guid dealershipId, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(exception);
        ArgumentNullException.ThrowIfNull(logger);
        if (BackstopConstraint is { } constraint)
        {
            SchedulerTelemetry.ConstraintBackstop.Add(1, new KeyValuePair<string, object?>("constraint", constraint));
            logger.ConstraintBackstopFired(constraint, dealershipId);
        }

        if (Deadlock)
        {
            SchedulerTelemetry.Deadlocks.Add(1);
            logger.DeadlockDetected(exception, dealershipId);
        }
    }
}

using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>Maps a PostgreSQL constraint or deadlock failure during booking to a <see cref="BookingAttempt"/> and telemetry recording.</summary>
/// <param name="Attempt">The attempt the booking transaction returns after rolling back.</param>
/// <param name="BackstopConstraint">The exclusion constraint that fired, or null.</param>
/// <param name="Deadlock">True when PostgreSQL terminated the transaction due to a deadlock (40P01).</param>
public sealed record BookingRefusal(BookingAttempt Attempt, string? BackstopConstraint, bool Deadlock)
{
    /// <summary>Maps <paramref name="failure"/> to a <see cref="BookingRefusal"/>, or returns null if unhandled.</summary>
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

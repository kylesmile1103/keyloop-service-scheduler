using Npgsql;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;

public enum PostgresFailure
{
    /// <summary>No <see cref="PostgresException"/> anywhere in the exception chain.</summary>
    None,
    BayOverlap,
    TechnicianOverlap,
    IdempotencyKeyDuplicate,
    Deadlock,
    CheckViolation,

    /// <summary>A PostgreSQL error this classifier does not interpret.</summary>
    Other,
}

/// <summary>The single place SQLSTATEs are interpreted (SYSTEM_DESIGN §7.4).</summary>
public static class PostgresErrorClassifier
{
    public const string BayConstraint = "ex_appointments_bay_no_overlap";

    public const string TechnicianConstraint = "ex_appointments_technician_no_overlap";

    /// <summary>The snake-case naming convention's name for the <c>idempotency_keys</c> primary key.</summary>
    public const string IdempotencyKeyConstraint = "pk_idempotency_keys";

    /// <summary>Classifies the first <see cref="PostgresException"/> in <paramref name="exception"/>'s <see cref="Exception.InnerException"/> chain.</summary>
    public static PostgresFailure Classify(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException postgres)
            {
                return postgres.SqlState switch
                {
                    PostgresErrorCodes.ExclusionViolation when postgres.ConstraintName == BayConstraint => PostgresFailure.BayOverlap,
                    PostgresErrorCodes.ExclusionViolation when postgres.ConstraintName == TechnicianConstraint => PostgresFailure.TechnicianOverlap,
                    PostgresErrorCodes.UniqueViolation when postgres.ConstraintName == IdempotencyKeyConstraint => PostgresFailure.IdempotencyKeyDuplicate,
                    PostgresErrorCodes.DeadlockDetected => PostgresFailure.Deadlock,
                    PostgresErrorCodes.CheckViolation => PostgresFailure.CheckViolation,
                    _ => PostgresFailure.Other,
                };
            }
        }

        return PostgresFailure.None;
    }
}

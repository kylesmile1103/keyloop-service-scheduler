using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Infrastructure.Telemetry;

/// <summary>Source-generated persistence and notification logs with stable event ids and names (ADR-016).</summary>
internal static partial class InfrastructureLog
{
    [LoggerMessage(EventId = 1400, EventName = "TriageUnavailable", Level = LogLevel.Warning,
        Message = "Booking triage unavailable ({Reason}); manual service selection remains available")]
    public static partial void TriageUnavailable(this ILogger logger, string reason);

    [LoggerMessage(EventId = 1401, EventName = "TriageRetry", Level = LogLevel.Information,
        Message = "Retrying booking triage once after upstream status {Status}")]
    public static partial void TriageRetry(this ILogger logger, int status);

    [LoggerMessage(EventId = 1005, EventName = "DomainEventObserverFailed", Level = LogLevel.Error,
        Message = "Domain event observer {Observer} failed after commit for {EventTypes}; the committed change stands")]
    public static partial void DomainEventObserverFailed(this ILogger logger, Exception exception, string observer, string eventTypes);

    [LoggerMessage(EventId = 1100, EventName = "MigrationsApplied", Level = LogLevel.Information,
        Message = "Applied {Count} pending database migration(s): {Migrations}")]
    public static partial void MigrationsApplied(this ILogger logger, int count, string migrations);

    [LoggerMessage(EventId = 1101, EventName = "SeedCompleted", Level = LogLevel.Information,
        Message = "Seed '{Seed}' completed: {Created} row(s) created")]
    public static partial void SeedCompleted(this ILogger logger, string seed, int created);

    [LoggerMessage(EventId = 1107, EventName = "RequirementPolicyPublished", Level = LogLevel.Information,
        Message = "Seeding published requirement policy version {PolicyVersion} for dealership {DealershipId}; previous latest version {PreviousVersion} (0: none)")]
    public static partial void RequirementPolicyPublished(this ILogger logger, Guid dealershipId, int policyVersion, int previousVersion);

    [LoggerMessage(EventId = 1300, EventName = "NotificationSent", Level = LogLevel.Information,
        Message = "Notification {OutboxId} ({Kind}) for appointment {AppointmentId} accepted by the sender")]
    public static partial void NotificationSent(this ILogger logger, Guid outboxId, Guid appointmentId, string kind);

    [LoggerMessage(EventId = 1301, EventName = "NotificationRetried", Level = LogLevel.Warning,
        Message = "Notification {OutboxId} ({Kind}) for appointment {AppointmentId} failed attempt {Attempt} ({Failure}), next attempt {NextAttemptAt:O}")]
    public static partial void NotificationRetried(this ILogger logger, Guid outboxId, Guid appointmentId, string kind, int attempt, DateTime nextAttemptAt, string failure);

    [LoggerMessage(EventId = 1302, EventName = "NotificationFailed", Level = LogLevel.Error,
        Message = "Notification {OutboxId} ({Kind}) for appointment {AppointmentId} is a dead letter after {Attempts} attempts ({Failure})")]
    public static partial void NotificationFailed(this ILogger logger, Guid outboxId, Guid appointmentId, string kind, int attempts, string failure);

    [LoggerMessage(EventId = 1303, EventName = "NotificationDispatchCycleFailed", Level = LogLevel.Error,
        Message = "Notification dispatch cycle failed ({FailureType}), outstanding leases will expire")]
    public static partial void NotificationDispatchCycleFailed(this ILogger logger, string failureType);

    [LoggerMessage(EventId = 1304, EventName = "NotificationClaimLost", Level = LogLevel.Warning,
        Message = "Notification {OutboxId} ({Kind}) acknowledgement ignored because the claim is no longer owned")]
    public static partial void NotificationClaimLost(this ILogger logger, Guid outboxId, string kind);

    [LoggerMessage(EventId = 1305, EventName = "NotificationSuppressed", Level = LogLevel.Information,
        Message = "Notification {OutboxId} ({Kind}) for appointment {AppointmentId} suppressed without a send ({Reason})")]
    public static partial void NotificationSuppressed(this ILogger logger, Guid outboxId, Guid appointmentId, string kind, string reason);
}

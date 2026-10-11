using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Source-generated log methods with stable event ids (Addendum A §A5); product code logs only through these. Ids:
/// 1001 BookingConfirmed, 1002 BookingRejected, 1003 ConstraintBackstopFired, 1004 DeadlockDetected (Task 10 adds 1002–1004),
/// 1005 DomainEventObserverFailed, 1010 AppointmentCancelled; 1100 MigrationsApplied, 1101 SeedCompleted, 1102 ApiStarting;
/// 1200 UnhandledException. Never log customer PII: ids and the masked VIN only (SYSTEM_DESIGN §11.1).
/// </summary>
internal static partial class SchedulerLog
{
    [LoggerMessage(EventId = 1001, EventName = "BookingConfirmed", Level = LogLevel.Information,
        Message = "Booking {AppointmentId} confirmed at dealership {DealershipId}: bay {BayId}, technician {TechnicianId}, start {StartUtc:O}, vehicle {MaskedVin}")]
    public static partial void BookingConfirmed(
        this ILogger logger, Guid appointmentId, Guid dealershipId, Guid bayId, Guid technicianId, DateTime startUtc, string maskedVin);

    [LoggerMessage(EventId = 1005, EventName = "DomainEventObserverFailed", Level = LogLevel.Error,
        Message = "Domain event observer {Observer} failed after commit for {EventTypes}; the committed change stands")]
    public static partial void DomainEventObserverFailed(this ILogger logger, Exception exception, string observer, string eventTypes);

    [LoggerMessage(EventId = 1010, EventName = "AppointmentCancelled", Level = LogLevel.Information,
        Message = "Appointment {AppointmentId} cancelled (was {PreviousStatus})")]
    public static partial void AppointmentCancelled(this ILogger logger, Guid appointmentId, AppointmentStatus previousStatus);

    [LoggerMessage(EventId = 1100, EventName = "MigrationsApplied", Level = LogLevel.Information,
        Message = "Applied {Count} pending database migration(s): {Migrations}")]
    public static partial void MigrationsApplied(this ILogger logger, int count, string migrations);

    [LoggerMessage(EventId = 1101, EventName = "SeedCompleted", Level = LogLevel.Information,
        Message = "Seed '{Seed}' completed: {Created} row(s) created")]
    public static partial void SeedCompleted(this ILogger logger, string seed, int created);

    [LoggerMessage(EventId = 1102, EventName = "ApiStarting", Level = LogLevel.Information,
        Message = "Scheduler API starting in {Environment}: migrate on startup {MigrateOnStartup}, seed demo data {SeedDemoData}, OpenAPI and Scalar {ApiReference}, authentication {Authentication}")]
    public static partial void ApiStarting(
        this ILogger logger, string environment, bool migrateOnStartup, bool seedDemoData, string apiReference, string authentication);

    [LoggerMessage(EventId = 1200, EventName = "UnhandledException", Level = LogLevel.Error,
        Message = "Unhandled exception for {Method} {Path}; answered 500 internal-error")]
    public static partial void UnhandledException(this ILogger logger, Exception exception, string method, string path);
}

using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Source-generated log methods with stable event ids (Addendum A §A5); product code logs only through these. Ids:
/// 1001 BookingConfirmed, 1002 BookingRejected, 1003 ConstraintBackstopFired, 1004 DeadlockDetected (Task 10 adds 1002–1004),
/// 1005 DomainEventObserverFailed, 1010 AppointmentCancelled; 1100 MigrationsApplied, 1101 SeedCompleted, 1102 ApiStarting,
/// 1103 StartupValidationFailed, 1104 StartupConfigurationFailed (both written by StartupFailureLog); 1200 UnhandledException. Never log customer PII: ids and the masked VIN only (SYSTEM_DESIGN §11.1).
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

    /// <summary>
    /// The configuration failed validation and the API will not start. <paramref name="failures"/> are the validators' messages,
    /// each prefixed with the member names it concerns; validator messages never echo secret values, and neither the bound options
    /// nor the configuration are logged.
    /// </summary>
    [LoggerMessage(EventId = 1103, EventName = "StartupValidationFailed", Level = LogLevel.Critical,
        Message = "Configuration validation failed for {OptionsType}; the API will not start: {Failures}")]
    public static partial void StartupValidationFailed(this ILogger logger, string optionsType, string failures);

    /// <summary>
    /// Loading the configuration failed for a reason other than validation (e.g. the binder could not convert a value) and the API
    /// will not start. <paramref name="detail"/> is the exception's message with any quoted configuration value removed.
    /// </summary>
    [LoggerMessage(EventId = 1104, EventName = "StartupConfigurationFailed", Level = LogLevel.Critical,
        Message = "Configuration could not be loaded; the API will not start: {ExceptionType}: {Detail}")]
    public static partial void StartupConfigurationFailed(this ILogger logger, string exceptionType, string detail);

    [LoggerMessage(EventId = 1200, EventName = "UnhandledException", Level = LogLevel.Error,
        Message = "Unhandled exception for {Method} {Path}; answered 500 internal-error")]
    public static partial void UnhandledException(this ILogger logger, Exception exception, string method, string path);
}

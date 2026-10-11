using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Source-generated log methods with stable event ids (Addendum A §A5); product code logs only through these. Ids:
/// 1001 BookingConfirmed (written by the post-commit TelemetryDomainEventObserver), 1002 BookingRejected, 1003 ConstraintBackstopFired, 1004 DeadlockDetected,
/// 1005 DomainEventObserverFailed, 1010 AppointmentCancelled; 1100 MigrationsApplied, 1101 SeedCompleted, 1102 ApiStarting,
/// 1103 StartupValidationFailed, 1104 StartupConfigurationFailed (both written by StartupFailureLog), 1105 DemoDataReseeded, 1106 DemoReseedRefused;
/// 1200 UnhandledException. Never log customer PII: ids and the masked VIN only (SYSTEM_DESIGN §11.1).
/// </summary>
internal static partial class SchedulerLog
{
    [LoggerMessage(EventId = 1001, EventName = "BookingConfirmed", Level = LogLevel.Information,
        Message = "Booking {AppointmentId} confirmed at dealership {DealershipId}: bay {BayId}, technician {TechnicianId}, start {StartUtc:O}, vehicle {MaskedVin}")]
    public static partial void BookingConfirmed(
        this ILogger logger, Guid appointmentId, Guid dealershipId, Guid bayId, Guid technicianId, DateTime startUtc, string maskedVin);

    /// <summary>
    /// A booking was refused (<paramref name="outcome"/> is the <c>scheduler.booking.requests</c> outcome tag, e.g. <c>slot_unavailable</c>).
    /// Ids and the service code only: the request's customer and vehicle are never logged. <paramref name="serviceCode"/> is null when the
    /// request was rejected before the service type was read (validation, unknown dealership or service type).
    /// </summary>
    [LoggerMessage(EventId = 1002, EventName = "BookingRejected", Level = LogLevel.Information,
        Message = "Booking rejected at dealership {DealershipId} for service {ServiceCode}: {Outcome}")]
    public static partial void BookingRejected(this ILogger logger, string outcome, Guid dealershipId, string? serviceCode);

    /// <summary>
    /// An exclusion constraint rejected a booking that had passed the locked pre-check: some writer bypassed the booking path
    /// (SYSTEM_DESIGN §7.4). The constraint name says whether the bay or the technician overlapped.
    /// </summary>
    [LoggerMessage(EventId = 1003, EventName = "ConstraintBackstopFired", Level = LogLevel.Warning,
        Message = "Overlap constraint {Constraint} rejected a booking at dealership {DealershipId} that passed the locked pre-check; an out-of-band writer holds the slot")]
    public static partial void ConstraintBackstopFired(this ILogger logger, string constraint, Guid dealershipId);

    /// <summary>PostgreSQL broke a deadlock on the booking path, which ADR-003 says cannot happen: a code change has added a second lock.</summary>
    [LoggerMessage(EventId = 1004, EventName = "DeadlockDetected", Level = LogLevel.Warning,
        Message = "Deadlock detected while booking at dealership {DealershipId}; the booking path must take one lock only (ADR-003)")]
    public static partial void DeadlockDetected(this ILogger logger, Exception exception, Guid dealershipId);

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
    /// will not start. <paramref name="detail"/> contains only a recognised binder path/type or a fixed safe description.
    /// </summary>
    [LoggerMessage(EventId = 1104, EventName = "StartupConfigurationFailed", Level = LogLevel.Critical,
        Message = "Configuration could not be loaded; the API will not start: {ExceptionType}: {Detail}")]
    public static partial void StartupConfigurationFailed(this ILogger logger, string exceptionType, string detail);

    /// <summary>The Aspire dashboard's <em>Reseed demo data</em> command replaced the demo dealerships' appointments (Addendum C §C3).</summary>
    [LoggerMessage(EventId = 1105, EventName = "DemoDataReseeded", Level = LogLevel.Information,
        Message = "Demo data reseeded: {Deleted} appointment(s) deleted, {Created} created")]
    public static partial void DemoDataReseeded(this ILogger logger, int deleted, int created);

    /// <summary>
    /// A reseed request carried no <c>X-Reseed-Key</c> or the wrong one and was answered like an unknown route. The key presented is never
    /// logged, right or wrong.
    /// </summary>
    [LoggerMessage(EventId = 1106, EventName = "DemoReseedRefused", Level = LogLevel.Warning,
        Message = "Demo reseed refused: the X-Reseed-Key header was missing or wrong; answered 404")]
    public static partial void DemoReseedRefused(this ILogger logger);

    [LoggerMessage(EventId = 1200, EventName = "UnhandledException", Level = LogLevel.Error,
        Message = "Unhandled exception for {Method} {Path}; answered 500 internal-error")]
    public static partial void UnhandledException(this ILogger logger, Exception exception, string method, string path);
}

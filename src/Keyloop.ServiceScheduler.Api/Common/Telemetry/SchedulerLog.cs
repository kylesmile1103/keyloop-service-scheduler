using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>Source-generated request and host log definitions. Never log customer PII.</summary>
internal static partial class SchedulerLog
{
    private static readonly Func<ILogger, string, IDisposable?> RequestScopeDefinition = LoggerMessage.DefineScope<string>("ClientRequestId:{ClientRequestId}");
    private static readonly Func<ILogger, Guid, IDisposable?> DealershipScopeDefinition = LoggerMessage.DefineScope<Guid>("DealershipId:{DealershipId}");
    private static readonly Func<ILogger, Guid, IDisposable?> AppointmentScopeDefinition = LoggerMessage.DefineScope<Guid>("AppointmentId:{AppointmentId}");
    private static readonly Func<ILogger, string, IDisposable?> IdempotencyScopeDefinition = LoggerMessage.DefineScope<string>("IdempotencyKey:{IdempotencyKey}");

    public static IDisposable? RequestScope(this ILogger logger, string requestId) => RequestScopeDefinition(logger, requestId);
    public static IDisposable? DealershipScope(this ILogger logger, Guid dealershipId) => DealershipScopeDefinition(logger, dealershipId);
    public static IDisposable? AppointmentScope(this ILogger logger, Guid appointmentId) => AppointmentScopeDefinition(logger, appointmentId);
    public static IDisposable? IdempotencyScope(this ILogger logger, string key) => IdempotencyScopeDefinition(logger, key);

    [LoggerMessage(EventId = 1001, EventName = "BookingConfirmed", Level = LogLevel.Information,
        Message = "Booking {AppointmentId} confirmed at dealership {DealershipId}: bay {BayId}, technician {TechnicianId}, start {StartUtc:O}, vehicle {MaskedVin}")]
    public static partial void BookingConfirmed(
        this ILogger logger, Guid appointmentId, Guid dealershipId, Guid bayId, Guid technicianId, DateTime startUtc, string maskedVin);

    /// <summary>Logs a rejected booking by dealership, service code, and outcome tag without customer or vehicle PII.</summary>
    [LoggerMessage(EventId = 1002, EventName = "BookingRejected", Level = LogLevel.Information,
        Message = "Booking rejected at dealership {DealershipId} for service {ServiceCode}: {Outcome}")]
    public static partial void BookingRejected(this ILogger logger, string outcome, Guid dealershipId, string? serviceCode);

    /// <summary>Logs when a database exclusion constraint rejects a booking after the locked pre-check passed.</summary>
    [LoggerMessage(EventId = 1003, EventName = "ConstraintBackstopFired", Level = LogLevel.Warning,
        Message = "Overlap constraint {Constraint} rejected a booking at dealership {DealershipId} that passed the locked pre-check; an out-of-band writer holds the slot")]
    public static partial void ConstraintBackstopFired(this ILogger logger, string constraint, Guid dealershipId);

    /// <summary>Logs when PostgreSQL detects a deadlock on the booking path.</summary>
    [LoggerMessage(EventId = 1004, EventName = "DeadlockDetected", Level = LogLevel.Warning,
        Message = "Deadlock detected while booking at dealership {DealershipId}; the booking path must take one lock only (ADR-003)")]
    public static partial void DeadlockDetected(this ILogger logger, Exception exception, Guid dealershipId);

    [LoggerMessage(EventId = 1010, EventName = "AppointmentCancelled", Level = LogLevel.Information,
        Message = "Appointment {AppointmentId} cancelled (was {PreviousStatus})")]
    public static partial void AppointmentCancelled(this ILogger logger, Guid appointmentId, AppointmentStatus previousStatus);

    [LoggerMessage(EventId = 1102, EventName = "ApiStarting", Level = LogLevel.Information,
        Message = "Scheduler API starting in {Environment}: migrate on startup {MigrateOnStartup}, seed demo data {SeedDemoData}, OpenAPI and Scalar {ApiReference}, authentication {Authentication}")]
    public static partial void ApiStarting(
        this ILogger logger, string environment, bool migrateOnStartup, bool seedDemoData, string apiReference, string authentication);

    /// <summary>Logs startup options validation failures without echoing secret values.</summary>
    [LoggerMessage(EventId = 1103, EventName = "StartupValidationFailed", Level = LogLevel.Critical,
        Message = "Configuration validation failed for {OptionsType}; the API will not start: {Failures}")]
    public static partial void StartupValidationFailed(this ILogger logger, string optionsType, string failures);

    /// <summary>Logs non-validation configuration loading failures at startup with a sanitized detail message.</summary>
    [LoggerMessage(EventId = 1104, EventName = "StartupConfigurationFailed", Level = LogLevel.Critical,
        Message = "Configuration could not be loaded; the API will not start: {ExceptionType}: {Detail}")]
    public static partial void StartupConfigurationFailed(this ILogger logger, string exceptionType, string detail);

    /// <summary>Logs a completed demo data reseed operation.</summary>
    [LoggerMessage(EventId = 1105, EventName = "DemoDataReseeded", Level = LogLevel.Information,
        Message = "Demo data reseeded: {Deleted} appointment(s) deleted, {Created} created")]
    public static partial void DemoDataReseeded(this ILogger logger, int deleted, int created);

    /// <summary>Logs a refused demo reseed request without echoing the supplied key.</summary>
    [LoggerMessage(EventId = 1106, EventName = "DemoReseedRefused", Level = LogLevel.Warning,
        Message = "Demo reseed refused: the X-Reseed-Key header was missing or wrong; answered 404")]
    public static partial void DemoReseedRefused(this ILogger logger);

    [LoggerMessage(EventId = 1200, EventName = "UnhandledException", Level = LogLevel.Error,
        Message = "Unhandled exception for {Method} {Path}; answered 500 internal-error")]
    public static partial void UnhandledException(this ILogger logger, Exception exception, string method, string path);
    /// <summary>The must-be-zero HV invariant failed (<c>AllocationSafety</c>). Ids, the local date and policy facts only, never a name.</summary>
    [LoggerMessage(EventId = 1020, EventName = "AllocationBelowHvMinimum", Level = LogLevel.Critical,
        Message = "Allocation {AppointmentId} chose technician {TechnicianId} on local date {LocalDate} below policy {PolicyVersion} required {MinimumHvLevel}: effective {EffectiveHvLevel}; fired rules {FiredRules}")]
    public static partial void AllocationBelowHvMinimum(this ILogger logger, Guid appointmentId, Guid technicianId, string localDate, int policyVersion,
        int minimumHvLevel, int effectiveHvLevel, string firedRules);
}

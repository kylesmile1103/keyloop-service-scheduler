using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Source-generated log methods with stable event ids (Addendum A §A5). Ids: 1001 BookingConfirmed, 1002 BookingRejected,
/// 1003 ConstraintBackstopFired, 1004 DeadlockDetected, 1010 AppointmentCancelled (Tasks 7, 10, 11); 1100 MigrationsApplied,
/// 1101 SeedCompleted (Task 6).
/// </summary>
internal static partial class SchedulerLog
{
    [LoggerMessage(EventId = 1100, EventName = "MigrationsApplied", Level = LogLevel.Information,
        Message = "Applied {Count} pending database migration(s): {Migrations}")]
    public static partial void MigrationsApplied(this ILogger logger, int count, string migrations);

    [LoggerMessage(EventId = 1101, EventName = "SeedCompleted", Level = LogLevel.Information,
        Message = "Seed '{Seed}' completed: {Created} row(s) created")]
    public static partial void SeedCompleted(this ILogger logger, string seed, int created);
}

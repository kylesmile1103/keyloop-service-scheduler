using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Verifies that an allocated technician meets the resolved HV minimum and emits a critical telemetry alert if violated.
/// </summary>
internal static class AllocationSafety
{
    /// <returns>True when <paramref name="technician"/> meets the minimum on <paramref name="localDate"/>; otherwise counts and logs.</returns>
    internal static bool MeetsHvMinimum(Technician technician, JobRequirements requirements, DateOnly localDate, Guid appointmentId, ILogger logger)
    {
        var effective = technician.EffectiveHvLevel(localDate);
        if (effective >= requirements.MinimumHvLevel)
        {
            return true;
        }

        SchedulerTelemetry.AllocationBelowHvMinimum.Add(1);
        logger.AllocationBelowHvMinimum(appointmentId, technician.Id, localDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            requirements.PolicyVersion, requirements.MinimumHvLevel, effective, string.Join(',', requirements.FiredRules));
        return false;
    }
}

using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// The must-be-zero HV signal (ADR-029, ARCHITECTURE §12): the allocator's hard filter makes an allocation below the resolved HV
/// minimum impossible, so a hit is a defect. It is counted on <c>scheduler.allocation.below_hv_minimum</c> (no tags) and logged as
/// Critical event 1020 with what the runbook needs and nothing personal: the appointment and technician ids, the dealership-local date
/// the expiry was judged on, the policy version, the fired rule codes and both levels. <c>Appointment.Book</c> then refuses the
/// allocation independently, so the appointment id never commits.
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

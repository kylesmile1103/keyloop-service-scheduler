using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

/// <summary>Read-time review signal against the booking's hard requirements. Never reassigns or rewrites an appointment.</summary>
/// <param name="RequiresReview">True: staff should review this appointment; clean appointments omit this response.</param>
/// <param name="ReasonCodes">Bounded qualification-lapse codes, in stable order; never resource names or visitor text.</param>
public sealed record CompetenceWarningResponse(bool RequiresReview, IReadOnlyList<string> ReasonCodes);

public static class AppointmentCompetenceReader
{
    public static CompetenceWarningResponse Evaluate(RecordedRequirements requirements, ServiceBay bay, Technician technician, DateOnly localDate)
    {
        var reasons = new List<string>();
        if (!technician.IsActive) { reasons.Add("technician-inactive"); }
        if (requirements.Certifications.Except(technician.Certifications).Any()) { reasons.Add("technician-certification-removed"); }
        if (technician.EffectiveHvLevel(localDate) < requirements.MinimumHvLevel)
        {
            reasons.Add(technician.HvLevelValidUntil is { } expiry && expiry < localDate && technician.HvLevel >= requirements.MinimumHvLevel
                ? "technician-hv-expired" : "technician-hv-level-lowered");
        }
        if (!bay.IsActive) { reasons.Add("bay-inactive"); }
        if (requirements.BayCapabilities.Except(bay.Capabilities).Any()) { reasons.Add("bay-capability-removed"); }
        return new(reasons.Count > 0, reasons);
    }

    public static async Task<RecordedRequirements> RequirementsAsync(SchedulerDbContext db, Guid dealershipId, ServiceType service,
        RecordedRequirements? recorded, AllocationDecision? allocation, VehicleProfile profile, bool needsLiveDiagnosis, CancellationToken ct)
    {
        if (recorded is not null) { return recorded; }
        if (allocation is null)
        {
            return new(service.RequiredBayCapabilities.Order().ToArray(), service.RequiredCertifications.Order().ToArray(), 0);
        }
        // Compatibility for bookings made before the full snapshot existed. The service catalogue is read-only in Task 30.
        var rules = await db.RequirementRules.AsNoTracking()
            .Where(r => r.DealershipId == dealershipId && r.PolicyVersion == allocation.PolicyVersion).ToListAsync(ct);
        if (rules.Count == 0 && allocation.PolicyVersion is 1 or RequirementRule.DefaultPolicyVersion
            && !await db.RequirementPolicyVersions.AnyAsync(v => v.DealershipId == dealershipId && v.Version == allocation.PolicyVersion, ct))
        {
            rules = RequirementRule.DefaultPolicy(dealershipId)
                .Where(r => allocation.PolicyVersion != 1 || r.Code != RequirementRule.PostCollisionRuleCode)
                .Select(r => r with { PolicyVersion = allocation.PolicyVersion }).ToList();
        }
        var requirements = RequirementResolver.Resolve(service, profile, rules, needsLiveDiagnosis, allocation.PolicyVersion);
        // Minimum was recorded in every vehicle-aware allocation, including older default policies.
        return new(requirements.BayCapabilities.Order().ToArray(), requirements.Certifications.Order().ToArray(), allocation.MinimumHvLevel);
    }

    public static async Task<CompetenceWarningResponse?> ReadAsync(SchedulerDbContext db, Appointment appointment, TimeZoneInfo zone,
        ServiceType service, ServiceBay bay, Technician technician, CancellationToken ct)
    {
        var warning = Evaluate(await RequirementsAsync(db, appointment.DealershipId, service, appointment.RecordedRequirements,
            appointment.AllocationDecision, appointment.VehicleProfile, appointment.NeedsLiveDiagnosis, ct), bay, technician,
            LocalTimeConverter.ToLocalDate(appointment.Slot.StartUtc, zone));
        return warning.RequiresReview ? warning : null;
    }
}

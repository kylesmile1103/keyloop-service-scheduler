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

/// <summary>
/// The closed competence-warning reasons, in the fixed order a warning lists them (ADR-029 Task 30a amendment). The contract enumerates
/// exactly <see cref="All"/> (SchedulerOpenApi), so a new reason is a contract change.
/// </summary>
public static class CompetenceReasonCodes
{
    public const string TechnicianInactive = "technician-inactive";
    public const string TechnicianCertificationRemoved = "technician-certification-removed";
    public const string TechnicianHvExpired = "technician-hv-expired";
    public const string TechnicianHvLevelLowered = "technician-hv-level-lowered";
    public const string BayInactive = "bay-inactive";
    public const string BayCapabilityRemoved = "bay-capability-removed";

    public static IReadOnlyList<string> All { get; } =
        [TechnicianInactive, TechnicianCertificationRemoved, TechnicianHvExpired, TechnicianHvLevelLowered, BayInactive, BayCapabilityRemoved];
}

public static class AppointmentCompetenceReader
{
    /// <summary>
    /// Only an appointment that still holds its bay and technician (<see cref="Appointment.ActiveStatuses"/>: confirmed, checked in or
    /// in progress) can be reviewed or reassigned. Cancelled, completed and no-show appointments are history and are never flagged.
    /// </summary>
    public static bool AppliesTo(AppointmentStatus status) => Appointment.ActiveStatuses.Contains(status);

    public static CompetenceWarningResponse Evaluate(RecordedRequirements requirements, ServiceBay bay, Technician technician, DateOnly localDate)
    {
        var reasons = new List<string>();
        if (!technician.IsActive) { reasons.Add(CompetenceReasonCodes.TechnicianInactive); }
        if (requirements.Certifications.Except(technician.Certifications).Any()) { reasons.Add(CompetenceReasonCodes.TechnicianCertificationRemoved); }
        if (technician.EffectiveHvLevel(localDate) < requirements.MinimumHvLevel)
        {
            reasons.Add(technician.HvLevelValidUntil is { } expiry && expiry < localDate && technician.HvLevel >= requirements.MinimumHvLevel
                ? CompetenceReasonCodes.TechnicianHvExpired : CompetenceReasonCodes.TechnicianHvLevelLowered);
        }
        if (!bay.IsActive) { reasons.Add(CompetenceReasonCodes.BayInactive); }
        if (requirements.BayCapabilities.Except(bay.Capabilities).Any()) { reasons.Add(CompetenceReasonCodes.BayCapabilityRemoved); }
        return new(reasons.Count > 0, reasons);
    }

    /// <summary>
    /// The hard requirements recorded for an appointment, reconstructed for one booked before the full snapshot existed. A board read passes
    /// one dealership's <c>rulesByVersion</c> memo so each older policy version is read once per request, not once per appointment;
    /// a single appointment passes null.
    /// </summary>
    public static async Task<RecordedRequirements> RequirementsAsync(SchedulerDbContext db, Guid dealershipId, ServiceType service,
        RecordedRequirements? recorded, AllocationDecision? allocation, VehicleProfile profile, bool needsLiveDiagnosis,
        Dictionary<int, IReadOnlyList<RequirementRule>>? rulesByVersion, CancellationToken ct)
    {
        if (recorded is not null) { return recorded; }
        if (allocation is null)
        {
            return new(service.RequiredBayCapabilities.Order().ToArray(), service.RequiredCertifications.Order().ToArray(), 0);
        }
        if (rulesByVersion is null || !rulesByVersion.TryGetValue(allocation.PolicyVersion, out var rules))
        {
            rules = await RulesAsync(db, dealershipId, allocation.PolicyVersion, ct);
            rulesByVersion?.Add(allocation.PolicyVersion, rules);
        }
        var requirements = RequirementResolver.Resolve(service, profile, rules, needsLiveDiagnosis, allocation.PolicyVersion);
        // Minimum was recorded in every vehicle-aware allocation, including older default policies.
        return new(requirements.BayCapabilities.Order().ToArray(), requirements.Certifications.Order().ToArray(), allocation.MinimumHvLevel);
    }

    public static async Task<CompetenceWarningResponse?> ReadAsync(SchedulerDbContext db, Appointment appointment, TimeZoneInfo zone,
        ServiceType service, ServiceBay bay, Technician technician, CancellationToken ct)
    {
        if (!AppliesTo(appointment.Status)) { return null; }
        var warning = Evaluate(await RequirementsAsync(db, appointment.DealershipId, service, appointment.RecordedRequirements,
            appointment.AllocationDecision, appointment.VehicleProfile, appointment.NeedsLiveDiagnosis, rulesByVersion: null, ct), bay, technician,
            LocalTimeConverter.ToLocalDate(appointment.Slot.StartUtc, zone));
        return warning.RequiresReview ? warning : null;
    }

    // Compatibility for bookings made before the full snapshot existed. The service catalogue is read-only in Task 30.
    private static async Task<IReadOnlyList<RequirementRule>> RulesAsync(SchedulerDbContext db, Guid dealershipId, int policyVersion, CancellationToken ct)
    {
        var rules = await db.RequirementRules.AsNoTracking()
            .Where(r => r.DealershipId == dealershipId && r.PolicyVersion == policyVersion).ToListAsync(ct);
        if (rules.Count == 0 && policyVersion is 1 or RequirementRule.DefaultPolicyVersion
            && !await db.RequirementPolicyVersions.AnyAsync(v => v.DealershipId == dealershipId && v.Version == policyVersion, ct))
        {
            return RequirementRule.DefaultPolicy(dealershipId)
                .Where(r => policyVersion != 1 || r.Code != RequirementRule.PostCollisionRuleCode)
                .Select(r => r with { PolicyVersion = policyVersion }).ToArray();
        }
        return rules;
    }
}

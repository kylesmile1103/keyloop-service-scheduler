using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;

public sealed record ServiceCatalogueEntry(ServiceType ServiceType, bool Bookable);

/// <summary>
/// Shared catalogue/triage eligibility. Vehicle-aware: some dialog-submittable profile qualifies on the supplied dealership-local
/// date, ignoring busy time. Legacy: an active bay and technician qualify for the service type (ADR-029 Task 43a).
/// </summary>
public sealed class ServiceCatalogueReader(SchedulerDbContext db, RequirementPolicyReader policies)
{
    public async Task<IReadOnlyList<ServiceCatalogueEntry>> ReadAsync(Guid dealershipId, bool vehicleAwareRequirements, DateOnly localDate, CancellationToken ct)
    {
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealershipId && b.IsActive).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId && t.IsActive).ToListAsync(ct);
        var serviceTypes = await db.ServiceTypes.AsNoTracking().OrderBy(s => s.Name).ThenBy(s => s.Code).ToListAsync(ct);
        if (vehicleAwareRequirements)
        {
            var policy = await policies.ReadPolicyAsync(dealershipId, ct);
            return [.. serviceTypes.Select(service => new ServiceCatalogueEntry(service, QualifiesForSomeProfile(service)))];

            bool QualifiesForSomeProfile(ServiceType service)
            {
                foreach (var powertrain in Enum.GetValues<Powertrain>())
                {
                    foreach (var vehicleClass in Enum.GetValues<VehicleClass>())
                    {
                        // Phase 1 has no manufacturer rules. Live diagnosis only adds constraints, so false covers eligibility.
                        var profile = VehicleProfile.Unknown with { Powertrain = powertrain, VehicleClass = vehicleClass };
                        var requirements = RequirementResolver.Resolve(service, profile, policy.Rules, policyVersion: policy.Version);
                        if (bays.Exists(b => b.Satisfies(requirements)) && technicians.Exists(t => t.Satisfies(requirements, localDate)))
                        {
                            return true;
                        }
                    }
                }
                return false;
            }
        }

        return [.. serviceTypes.Select(service => new ServiceCatalogueEntry(service,
            bays.Exists(b => b.Supports(service)) && technicians.Exists(t => t.IsCertifiedFor(service))))];
    }
}

using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;

public sealed record RequirementPolicySnapshot(int Version, IReadOnlyList<RequirementRule> Rules);

/// <summary>Reads an immutable version before booking locks. Version markers represent intentionally empty policies.</summary>
public sealed class RequirementPolicyReader(SchedulerDbContext db)
{
    public async Task<RequirementPolicySnapshot> ReadPolicyAsync(Guid dealershipId, CancellationToken ct)
    {
        var version = await db.RequirementRules.Where(r => r.DealershipId == dealershipId).Select(r => (int?)r.PolicyVersion)
            .Concat(db.RequirementPolicyVersions.Where(r => r.DealershipId == dealershipId).Select(r => (int?)r.Version)).MaxAsync(ct);
        return version is null
            ? new(RequirementRule.DefaultPolicyVersion, RequirementRule.DefaultPolicy(dealershipId))
            : new(version.Value, await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == dealershipId && r.PolicyVersion == version.Value)
                .OrderBy(r => r.Order).ThenBy(r => r.Code).ThenBy(r => r.Id).ToListAsync(ct));
    }

    public async Task<IReadOnlyList<RequirementRule>> ReadAsync(Guid dealershipId, CancellationToken ct) =>
        (await ReadPolicyAsync(dealershipId, ct)).Rules;

    public async Task<JobRequirements> ResolveAsync(Guid dealershipId, Domain.Catalog.ServiceType service, VehicleProfile profile,
        bool needsLiveDiagnosis, CancellationToken ct)
    {
        var policy = await ReadPolicyAsync(dealershipId, ct);
        return RequirementResolver.Resolve(service, profile, policy.Rules, needsLiveDiagnosis, policy.Version);
    }
}

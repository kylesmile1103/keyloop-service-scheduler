using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;

public sealed record RequirementPolicySnapshot(int Version, IReadOnlyList<RequirementRule> Rules);

/// <summary>Reads an immutable version before booking locks. Version markers represent intentionally empty policies.</summary>
public sealed class RequirementPolicyReader(SchedulerDbContext db)
{
    public async Task<RequirementPolicySnapshot> ReadPolicyAsync(Guid dealershipId, CancellationToken ct)
    {
        var version = await StoredVersionAsync(dealershipId, ct);
        return version is null
            ? new(RequirementRule.DefaultPolicyVersion, RequirementRule.DefaultPolicy(dealershipId))
            : new(version.Value, await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == dealershipId && r.PolicyVersion == version.Value)
                .OrderBy(r => r.Order).ThenBy(r => r.Code).ThenBy(r => r.Id).ToListAsync(ct));
    }

    /// <summary>
    /// The version <see cref="ReadPolicyAsync"/> would resolve now, without its rules: one plain read that takes no lock. A booking calls
    /// it under its dealership lock, where it is settled, because an Admin publication commits only while holding that same lock.
    /// </summary>
    public async Task<int> LatestVersionAsync(Guid dealershipId, CancellationToken ct) =>
        await StoredVersionAsync(dealershipId, ct) ?? RequirementRule.DefaultPolicyVersion;

    private Task<int?> StoredVersionAsync(Guid dealershipId, CancellationToken ct) =>
        db.RequirementRules.Where(r => r.DealershipId == dealershipId).Select(r => (int?)r.PolicyVersion)
            .Concat(db.RequirementPolicyVersions.Where(r => r.DealershipId == dealershipId).Select(r => (int?)r.Version)).MaxAsync(ct);

    public async Task<IReadOnlyList<RequirementRule>> ReadAsync(Guid dealershipId, CancellationToken ct) =>
        (await ReadPolicyAsync(dealershipId, ct)).Rules;

    public async Task<JobRequirements> ResolveAsync(Guid dealershipId, Domain.Catalog.ServiceType service, VehicleProfile profile,
        bool needsLiveDiagnosis, CancellationToken ct)
    {
        var policy = await ReadPolicyAsync(dealershipId, ct);
        return RequirementResolver.Resolve(service, profile, policy.Rules, needsLiveDiagnosis, policy.Version);
    }
}

using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;

/// <summary>Reads exactly the latest policy version before booking acquires any lock. An unconfigured dealership uses the closed default v2.</summary>
public sealed class RequirementPolicyReader(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<RequirementRule>> ReadAsync(Guid dealershipId, CancellationToken ct)
    {
        var rules = await db.Set<RequirementRule>().AsNoTracking().Where(r => r.DealershipId == dealershipId).ToListAsync(ct);
        return rules.Count == 0 ? RequirementRule.DefaultPolicy(dealershipId) : rules.Where(r => r.PolicyVersion == rules.Max(r => r.PolicyVersion)).ToArray();
    }
}

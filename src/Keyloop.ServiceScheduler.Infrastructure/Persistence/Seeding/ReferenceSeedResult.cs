using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

/// <summary>A requirement policy version one seeding call wrote for a dealership, and the latest version before it (0: none).</summary>
public sealed record PublishedRequirementPolicy(Guid DealershipId, int Version, int PreviousVersion);

/// <summary>Result of <see cref="ReferenceDataSeed.EnsureSeededAsync"/>: rows added and policy versions published.</summary>
public sealed record ReferenceSeedResult(int RowsAdded, IReadOnlyList<PublishedRequirementPolicy> PublishedPolicies)
{
    /// <summary>Writes <c>1107 RequirementPolicyPublished</c> once per published version. Call only after the transaction commits.</summary>
    public void LogPublished(ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(logger);
        foreach (var policy in PublishedPolicies)
        {
            logger.RequirementPolicyPublished(policy.DealershipId, policy.Version, policy.PreviousVersion);
        }
    }
}

using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

/// <summary>A requirement policy version one seeding call wrote for a dealership, and the latest version before it (0: none).</summary>
public sealed record PublishedRequirementPolicy(Guid DealershipId, int Version, int PreviousVersion);

/// <summary>What one <see cref="ReferenceDataSeed.EnsureSeededAsync"/> call wrote: rows added and the policy versions it published.</summary>
/// <remarks>
/// Seeding runs inside its caller's transaction, under a retrying execution strategy, so it never logs: an attempt that rolls back
/// would otherwise have announced versions that never existed, and its retry would announce them again. The caller logs
/// <see cref="LogPublished"/> after the commit, from the result of the attempt that committed. If a commit succeeds but its
/// acknowledgement is lost, the retry finds the versions already stored and publishes nothing, so a version is logged at most once.
/// </remarks>
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

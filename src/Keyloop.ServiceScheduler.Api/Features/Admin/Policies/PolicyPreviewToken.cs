using System.Security.Cryptography;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

/// <summary>Fingerprints confirmed consequences, never resource versions or private roster fields.</summary>
internal static class PolicyPreviewToken
{
    public static RequirementRuleInput[] NormalizeRules(IReadOnlyList<RequirementRuleInput> rules) => rules
        .OrderBy(r => r.Order).ThenBy(r => r.Code, StringComparer.Ordinal)
        .Select(r => r with
        {
            Powertrains = r.Powertrains.Order().ToArray(),
            ServiceCodes = r.ServiceCodes.Order(StringComparer.Ordinal).ToArray(),
            BayCapabilities = r.BayCapabilities.Order().ToArray(),
            Certifications = r.Certifications.Order().ToArray(),
        }).ToArray();

    public static string Compute(Guid dealershipId, int currentPolicyVersion, IReadOnlyList<RequirementRuleInput> rules,
        DateOnly previewDate, IReadOnlyList<PolicyBookabilityChange> changes)
    {
        var input = new PolicyPreviewTokenInput(dealershipId, currentPolicyVersion, NormalizeRules(rules), previewDate,
            changes.OrderBy(c => c.ServiceCode, StringComparer.Ordinal).ThenBy(c => c.Powertrain).ThenBy(c => c.VehicleClass)
                .ThenBy(c => c.NeedsLiveDiagnosis).ToArray());
        var json = JsonSerializer.SerializeToUtf8Bytes(input, SchedulerJsonContext.Default.PolicyPreviewTokenInput);
        return Convert.ToBase64String(SHA256.HashData(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}

internal sealed record PolicyPreviewTokenInput(Guid DealershipId, int CurrentPolicyVersion, RequirementRuleInput[] Rules,
    DateOnly PreviewDate, PolicyBookabilityChange[] Changes);

using Keyloop.ServiceScheduler.Domain.Catalog;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>Pure, deterministic and monotone resolution of one version of a dealership policy.</summary>
public static class RequirementResolver
{
    /// <summary>
    /// Rule code recorded when a service requires <c>HighVoltageElectrical</c>, establishing an HV level-3 floor before policy rules apply.
    /// </summary>
    public const string LegacyHvComponentRule = "legacy-hv-component";

    public static JobRequirements Resolve(ServiceType service, VehicleProfile profile, IReadOnlyList<RequirementRule> rules, bool needsLiveDiagnosis = false, int? policyVersion = null)
    {
        ArgumentNullException.ThrowIfNull(service);
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(rules);
        var versions = rules.Select(r => r.PolicyVersion).Concat(policyVersion is { } version ? new[] { version } : []).Distinct().ToArray();
        if (versions.Length != 1 || versions[0] < 1)
        {
            throw new ArgumentException("Resolve exactly one positive policy version.", nameof(rules));
        }
        var bays = service.RequiredBayCapabilities.ToHashSet();
        // HighVoltageElectrical certification denotes HV component work and establishes a level-3 minimum even for ICE vehicles.
        var certifications = service.RequiredCertifications.Where(c => c != Resources.Certification.HighVoltageElectrical).ToHashSet();
        var legacyComponentWork = service.RequiredCertifications.Contains(Resources.Certification.HighVoltageElectrical);
        var minimum = legacyComponentWork ? 3 : 0;
        var fired = legacyComponentWork ? new List<string> { LegacyHvComponentRule } : [];
        foreach (var rule in rules.OrderBy(r => r.Order).ThenBy(r => r.Code, StringComparer.Ordinal).ThenBy(r => r.Id))
        {
            if (rule.MinimumHvLevel is < 0 or > 4)
            {
                throw new ArgumentException("Policy HV levels must be between zero and four.", nameof(rules));
            }
            var applies = rule.Condition switch
            {
                RequirementCondition.ServicePowertrain => rule.ServiceCodes.Contains(service.Code, StringComparer.Ordinal) && MatchesPowertrain(rule, profile.Powertrain),
                RequirementCondition.VehicleClass => profile.VehicleClass == rule.VehicleClass,
                RequirementCondition.LiveDiagnosis => needsLiveDiagnosis,
                _ => throw new ArgumentException("Unknown policy condition.", nameof(rules)),
            };
            if (!applies)
            {
                continue;
            }
            minimum = Math.Max(minimum, rule.MinimumHvLevel);
            bays.UnionWith(rule.BayCapabilities);
            certifications.UnionWith(rule.Certifications);
            fired.Add(rule.Code);
        }
        return new(bays, certifications, minimum, versions[0], fired.ToArray());
    }
    // Unknown must inherit every rule for any concrete HV powertrain, including dealership-specific tightening rules.
    private static bool MatchesPowertrain(RequirementRule rule, Powertrain powertrain) => rule.Powertrains.Contains(powertrain)
        || (powertrain == Powertrain.Unknown && rule.Powertrains.Any(p => p != Powertrain.Ice));
}

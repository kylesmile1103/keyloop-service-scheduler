using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Admin;

public sealed class PolicyPreviewTokenTests
{
    private static readonly Guid Site = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Service = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateOnly Date = new(2026, 10, 13);
    private static readonly RequirementRuleInput Rule = new("hv-routine", 20, RequirementCondition.ServicePowertrain,
        [Powertrain.BatteryElectric], ["INTERIM-SERVICE"], null, 4, [], []);
    private static readonly PolicyBookabilityChange Change = new(Service, "INTERIM-SERVICE", Powertrain.BatteryElectric,
        VehicleClass.Car, false, true, false);

    [Fact]
    public void Canonical_source_generated_JSON_has_a_stable_known_SHA256_digest()
    {
        PolicyPreviewToken.Compute(Site, 2, [Rule], Date, [Change]).ShouldBe("3YXC2aAiouQUVFBeh5HyO9a2Y6zMtLSPrLEZewNwo6E");
    }

    [Fact]
    public void Rule_selector_and_consequence_order_do_not_change_the_token()
    {
        var rule = Rule with
        {
            Powertrains = [Powertrain.Unknown, Powertrain.BatteryElectric],
            ServiceCodes = ["MOT", "INTERIM-SERVICE"],
            BayCapabilities = [BayCapability.Diagnostics, BayCapability.StandardLift],
            Certifications = [Certification.Brakes, Certification.GeneralService],
        };
        var other = rule with { Code = "other", Order = 10 };
        var change = Change with { Powertrain = Powertrain.Unknown, VehicleClass = VehicleClass.Heavy, NeedsLiveDiagnosis = true };
        var ordered = rule with
        {
            Powertrains = [.. rule.Powertrains.Reverse()], ServiceCodes = [.. rule.ServiceCodes.Reverse()],
            BayCapabilities = [.. rule.BayCapabilities.Reverse()], Certifications = [.. rule.Certifications.Reverse()],
        };
        var token = PolicyPreviewToken.Compute(Site, 2, [rule, other], Date, [change, Change]);
        PolicyPreviewToken.Compute(Site, 2, [other, ordered], Date, [Change, change]).ShouldBe(token);
    }

    [Fact]
    public void Dealership_version_rules_date_and_consequences_each_bind_the_token()
    {
        var token = PolicyPreviewToken.Compute(Site, 2, [Rule], Date, [Change]);
        PolicyPreviewToken.Compute(Service, 2, [Rule], Date, [Change]).ShouldNotBe(token);
        PolicyPreviewToken.Compute(Site, 3, [Rule], Date, [Change]).ShouldNotBe(token);
        PolicyPreviewToken.Compute(Site, 2, [Rule with { MinimumHvLevel = 3 }], Date, [Change]).ShouldNotBe(token);
        PolicyPreviewToken.Compute(Site, 2, [Rule], Date.AddDays(1), [Change]).ShouldNotBe(token);
        PolicyPreviewToken.Compute(Site, 2, [Rule], Date, [Change with { IsBookable = true }]).ShouldNotBe(token);
    }
}

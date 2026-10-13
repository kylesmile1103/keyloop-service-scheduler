using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Admin;

public sealed class PolicyValidationTests
{
    [Fact]
    public void Invalid_typed_enums_are_validation_errors_even_when_the_size_check_cannot_serialize_them()
    {
        var input = new PolicyWriteRequest([new("invalid", 0, (RequirementCondition)999, [], [], null, 0, [], [])], true, new(2026, 10, 13));
        var result = new PolicyWriteValidator().Validate(input);
        result.IsValid.ShouldBeFalse();
        result.Errors.ShouldContain(e => e.PropertyName == "Rules[0].Condition");
    }

    [Fact]
    public void Oversized_typed_policy_is_rejected_before_it_can_exceed_the_audit_bound()
    {
        var services = Enumerable.Range(0, 32).Select(n => "S-" + new string('A', 60) + n.ToString("D2", System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        var rules = Enumerable.Range(0, 32).Select(n => new RequirementRuleInput("rule-" + n.ToString(System.Globalization.CultureInfo.InvariantCulture),
            n, RequirementCondition.ServicePowertrain, [Powertrain.Unknown], services, null, 0, [], [])).ToArray();
        var result = new PolicyWriteValidator().Validate(new PolicyWriteRequest(rules, true, new(2026, 10, 13)));
        result.IsValid.ShouldBeFalse();
        result.Errors.ShouldContain(e => e.PropertyName == "Rules" && e.ErrorMessage.Contains("snapshot", StringComparison.Ordinal));
    }
}

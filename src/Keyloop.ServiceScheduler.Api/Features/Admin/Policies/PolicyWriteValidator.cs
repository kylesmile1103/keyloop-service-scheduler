using System.Text;
using System.Text.Json;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

public sealed class PolicyWriteValidator : AbstractValidator<PolicyWriteRequest>
{
    public PolicyWriteValidator()
    {
        RuleFor(r => r.PreviewDate).NotEqual(default(DateOnly));
        RuleFor(r => r.Rules).NotNull().Must(v => v is not null && v.Length <= 32
            && v.All(r => r is not null) && v.Select(r => r.Code).Distinct(StringComparer.Ordinal).Count() == v.Length);
        RuleFor(r => r.Rules).Must(WithinSnapshotBound).WithMessage("The policy exceeds the bounded audit snapshot size.");
        RuleForEach(r => r.Rules).SetValidator(new RequirementRuleInputValidator());
    }

    private static bool WithinSnapshotBound(RequirementRuleInput[]? rules)
    {
        if (rules is null) { return true; }
        try
        {
            return Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(rules, SchedulerJsonContext.Default.RequirementRuleInputArray)) <= 48000;
        }
        catch (JsonException)
        {
            // The element validators report invalid enum values; a size check must not turn a malformed typed rule into a 500.
            return true;
        }
    }
}

public sealed class RequirementRuleInputValidator : AbstractValidator<RequirementRuleInput>
{
    public RequirementRuleInputValidator()
    {
        RuleFor(r => r.Code).NotEmpty().Matches("^[a-z][a-z0-9-]{0,63}$");
        RuleFor(r => r.Order).GreaterThanOrEqualTo(0);
        RuleFor(r => r.Condition).IsInEnum();
        RuleFor(r => r.MinimumHvLevel).InclusiveBetween(0, 4);
        RuleFor(r => r.Powertrains).NotNull().Must(v => v is not null && v.Length <= 7 && v.Distinct().Count() == v.Length);
        RuleForEach(r => r.Powertrains).IsInEnum();
        RuleFor(r => r.ServiceCodes).NotNull().Must(v => v is not null && v.Length <= 32 && v.Distinct(StringComparer.Ordinal).Count() == v.Length);
        RuleForEach(r => r.ServiceCodes).NotEmpty().Matches("^[A-Z0-9][A-Z0-9-]{0,63}$");
        RuleFor(r => r.BayCapabilities).NotNull().Must(v => v is not null && v.Length <= 32 && v.Distinct().Count() == v.Length);
        RuleForEach(r => r.BayCapabilities).IsInEnum();
        RuleFor(r => r.Certifications).NotNull().Must(v => v is not null && v.Length <= 32 && v.Distinct().Count() == v.Length);
        RuleForEach(r => r.Certifications).IsInEnum();
        RuleFor(r => r.VehicleClass).IsInEnum().When(r => r.VehicleClass.HasValue);
        RuleFor(r => r).Must(r => r.Condition switch
        {
            RequirementCondition.ServicePowertrain => r.Powertrains is { Length: > 0 } && r.ServiceCodes is { Length: > 0 } && r.VehicleClass is null,
            RequirementCondition.VehicleClass => r.VehicleClass.HasValue && r.Powertrains is { Length: 0 } && r.ServiceCodes is { Length: 0 },
            RequirementCondition.LiveDiagnosis => r.VehicleClass is null && r.Powertrains is { Length: 0 } && r.ServiceCodes is { Length: 0 },
            _ => false,
        }).WithMessage("Use only the selectors belonging to the typed condition.");
    }
}

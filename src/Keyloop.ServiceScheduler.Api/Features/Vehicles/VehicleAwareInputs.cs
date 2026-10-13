using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles;

/// <summary>
/// Rejects vehicle-aware inputs with a 422 <c>vehicle-aware-requirements-disabled</c> error when <c>Scheduling:VehicleAwareRequirements</c> is disabled.
/// </summary>
public static class VehicleAwareInputs
{
    public const string DisabledRule = "vehicle-aware-requirements-disabled";

    private const string DisabledDetail =
        "Vehicle-aware requirements are disabled in this deployment, so the vehicle profile and live-diagnosis inputs cannot be honoured. Omit them to use the service's standard qualification.";

    /// <param name="enabled">The <c>Scheduling:VehicleAwareRequirements</c> option.</param>
    /// <param name="inputs">Each input's contract name and whether the request carries it, in the order to report them.</param>
    public static void EnsureHonoured(bool enabled, params ReadOnlySpan<(string Field, bool Present)> inputs)
    {
        if (enabled)
        {
            return;
        }

        var rejected = new List<string>();
        foreach (var (field, present) in inputs)
        {
            if (present)
            {
                rejected.Add(field);
            }
        }

        if (rejected.Count > 0)
        {
            throw new DomainRuleViolationException(DisabledRule, DisabledDetail, new Dictionary<string, object?> { ["rejectedFields"] = rejected.ToArray() });
        }
    }
}

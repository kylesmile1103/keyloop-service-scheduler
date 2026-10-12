using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles;

/// <summary>
/// The vehicle-aware inputs (ADR-029) are honoured only with <c>Scheduling:VehicleAwareRequirements</c> on. With it off, qualification
/// is the legacy service-type check, so a live-HV flag or a vehicle profile would be silently ignored, and any technician certified for
/// the service could take work the client explicitly marked as live HV. Such a request is refused instead: 422
/// <c>vehicle-aware-requirements-disabled</c> with <c>rejectedFields</c>. A request without these inputs is unchanged.
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

namespace Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;

/// <summary>Environment-wide switches a client needs to decide which controls to render. Identical for every caller.</summary>
/// <example>{"vehicleAwareRequirements":false}</example>
public sealed record FeatureSwitchesResponse(bool VehicleAwareRequirements)
{
    /// <summary>Whether vehicle-aware booking inputs, availability filters and allocation explanations are enabled. Changes require an API restart.</summary>
    /// <example>false</example>
    public bool VehicleAwareRequirements { get; init; } = VehicleAwareRequirements;
}

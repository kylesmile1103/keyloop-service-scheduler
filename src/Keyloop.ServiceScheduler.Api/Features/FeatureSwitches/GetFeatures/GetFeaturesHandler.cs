using Keyloop.ServiceScheduler.Api.Common.Options;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;

/// <summary>Projects only rendering switches from the same startup options the scheduling slices use.</summary>
public sealed class GetFeaturesHandler(IOptions<SchedulingOptions> options)
{
    public FeatureSwitchesResponse Handle() => new(options.Value.VehicleAwareRequirements);
}

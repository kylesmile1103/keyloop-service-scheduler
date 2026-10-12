using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Vehicles;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;

/// <summary>Transient offline resolution. No storage, HTTP client, logging or tracing of input identifiers.</summary>
public sealed class ResolveVehicleProfileHandler
{
    public VehicleProfile Handle(ResolveVehicleProfileRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WmiDecoder.Decode(request.Vin is null ? null : Vin.Create(request.Vin));
    }
}

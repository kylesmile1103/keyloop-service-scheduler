using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Vehicles;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;

/// <summary>Combines server-decoded attributes and advisor declarations without trusting client provenance.</summary>
public static class VehicleProfileResolution
{
    public static VehicleProfile Resolve(Vin? vin, VehicleProfileRequest? declared, string actor)
    {
        var decoded = WmiDecoder.Decode(vin);
        if (declared is null)
        {
            return decoded;
        }
        var manufacturer = VehicleProfile.NormalizeManufacturer(declared.Manufacturer);
        if (manufacturer != "UNKNOWN" && decoded.Manufacturer != "UNKNOWN" && manufacturer != decoded.Manufacturer
            && declared.ConflictChoice != ProfileConflictChoice.UseDecoded)
        {
            throw new DomainRuleViolationException("vehicle-profile-conflict", "Declared and decoded manufacturer disagree. Choose UseDecoded explicitly to continue.",
                new Dictionary<string, object?> { ["conflictingAttributes"] = new[] { "manufacturer" } });
        }
        return decoded with
        {
            Powertrain = declared.Powertrain,
            Manufacturer = decoded.Manufacturer != "UNKNOWN" ? decoded.Manufacturer : manufacturer,
            VehicleClass = declared.VehicleClass,
            Provenance = new(
                declared.Powertrain == Powertrain.Unknown ? ProfileSource.Unknown : ProfileSource.Declared,
                decoded.Manufacturer != "UNKNOWN" ? ProfileSource.VinDecoded : manufacturer != "UNKNOWN" ? ProfileSource.Declared : ProfileSource.Unknown,
                declared.VehicleClass == VehicleClass.Unknown ? ProfileSource.Unknown : ProfileSource.Declared,
                declared.Powertrain == Powertrain.Unknown ? null : actor,
                declared.Powertrain == Powertrain.Unknown ? null : declared.DeclarationReason!.Trim()),
        };
    }
}

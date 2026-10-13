using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Infrastructure.Vehicles;

/// <summary>Offline, deliberately small WMI allowlist. No inference of powertrain/class from manufacturer or free-text make/model.</summary>
public static class WmiDecoder
{
    // Curated passenger-car WMI mappings from NHTSA vPIC records; unmapped prefixes resolve to UNKNOWN.
    public static VehicleProfile Decode(Vin? vin)
    {
        var manufacturer = vin?.Value[..3] switch
        {
            "WVW" => "VOLKSWAGEN",
            "WBA" => "BMW",
            "WDD" => "MERCEDES-BENZ",
            "VF1" => "RENAULT",
            "JTD" => "TOYOTA",
            "5YJ" => "TESLA",
            _ => "UNKNOWN",
        };
        return VehicleProfile.Unknown with
        {
            Manufacturer = manufacturer,
            Provenance = VehicleProfile.Unknown.Provenance with { Manufacturer = manufacturer == "UNKNOWN" ? ProfileSource.Unknown : ProfileSource.VinDecoded },
        };
    }
}

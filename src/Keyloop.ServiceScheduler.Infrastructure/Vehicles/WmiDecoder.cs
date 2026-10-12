using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Infrastructure.Vehicles;

/// <summary>Offline, deliberately small WMI allowlist. No inference of powertrain/class from manufacturer or free-text make/model.</summary>
public static class WmiDecoder
{
    // Attribution: NHTSA vPIC manufacturer-submitted WMI records, DecodeWMI (https://vpic.nhtsa.dot.gov/api/).
    // These common passenger-car WMIs are explicitly reviewed mappings, not scraped names or prefix guesses. Other WMIs abstain.
    // The API documentation and exact lookup references are recorded in docs/design/wmi-provenance.md. No request performs a lookup.
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

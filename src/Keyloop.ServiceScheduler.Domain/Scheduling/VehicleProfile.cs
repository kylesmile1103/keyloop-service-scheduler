using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>Closed powertrain vocabulary; all hybrid/electric/fuel-cell and Unknown values take conservative HV requirements.</summary>
public enum Powertrain { Ice, MildHybrid, FullHybrid, PluginHybrid, BatteryElectric, FuelCell, Unknown }
/// <summary>Workshop-relevant vehicle class; Heavy adds lift and task competence requirements.</summary>
public enum VehicleClass { Car, LightCommercial, Heavy, Unknown }
/// <summary>Per-attribute source. RegistryLookup and SuggestedConfirmed are reserved for later phases.</summary>
public enum ProfileSource { Unknown, Declared, VinDecoded, RegistryLookup, SuggestedConfirmed }

/// <summary>Evidence for each attribute. Declaration accountability is private audit data, never telemetry or email content.</summary>
/// <param name="Powertrain">Evidence for the powertrain attribute.</param>
/// <param name="Manufacturer">Evidence for the manufacturer attribute.</param>
/// <param name="VehicleClass">Evidence for the class attribute.</param>
/// <param name="DeclaredBy">Authenticated declaration actor, private audit data; null for no powertrain declaration.</param>
/// <param name="DeclarationReason">Private reason, 1..500 trimmed characters; never email or telemetry content.</param>
public sealed record ProfileProvenance(ProfileSource Powertrain, ProfileSource Manufacturer, ProfileSource VehicleClass,
    string? DeclaredBy, string? DeclarationReason);

/// <summary>Vehicle facts independent of identifiers. Unknown powertrain is conservatively treated as high voltage.</summary>
/// <param name="Powertrain">Resolved powertrain; Unknown conservatively inherits concrete HV rules.</param>
/// <param name="Manufacturer">Normalized OEM code, or UNKNOWN.</param>
/// <param name="VehicleClass">Resolved workshop class; Unknown carries no heavy-vehicle assertion.</param>
/// <param name="Provenance">Server-assigned attribute sources and private declaration accountability.</param>
public sealed record VehicleProfile(Powertrain Powertrain, string Manufacturer, VehicleClass VehicleClass, ProfileProvenance Provenance)
{
    public const int MaxDeclarationReasonLength = 500;
    public static VehicleProfile Unknown { get; } = new(Powertrain.Unknown, "UNKNOWN", VehicleClass.Unknown,
        new(ProfileSource.Unknown, ProfileSource.Unknown, ProfileSource.Unknown, null, null));

    public static string NormalizeManufacturer(string? manufacturer)
    {
        if (string.IsNullOrWhiteSpace(manufacturer))
        {
            return "UNKNOWN";
        }
        var code = Guard.Required(manufacturer, 1, 32, nameof(manufacturer)).ToUpperInvariant();
        if (!code.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))
        {
            throw new ArgumentException("Manufacturer must be an OEM code of letters, digits or hyphens.", nameof(manufacturer));
        }
        return code;
    }
}

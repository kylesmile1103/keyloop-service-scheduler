using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public enum Powertrain { Ice, MildHybrid, FullHybrid, PluginHybrid, BatteryElectric, FuelCell, Unknown }
public enum VehicleClass { Car, LightCommercial, Heavy, Unknown }
public enum ProfileSource { Unknown, Declared, VinDecoded, RegistryLookup, SuggestedConfirmed }

/// <summary>Evidence for each attribute. Declaration accountability is private audit data, never telemetry or email content.</summary>
public sealed record ProfileProvenance(ProfileSource Powertrain, ProfileSource Manufacturer, ProfileSource VehicleClass,
    string? DeclaredBy, string? DeclarationReason);

/// <summary>Vehicle facts independent of identifiers. Unknown powertrain is conservatively treated as high voltage.</summary>
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

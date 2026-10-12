using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public sealed record VehicleDetails
{
    /// <summary>
    /// The whole-registration mask: seven asterisks whatever the plate, so neither its distinctive last letters nor its length show.
    /// The anonymous schedule and range reads return it, and <see cref="ToString"/> prints it.
    /// </summary>
    public const string MaskedRegistration = "*******";

    public VehicleDetails(Vin vin, string registration, string make, string model)
    {
        ArgumentNullException.ThrowIfNull(vin);
        Vin = vin;
        Registration = Guard.Required(registration, 1, 16, nameof(registration)).ToUpperInvariant();
        Make = Guard.Required(make, 1, 60, nameof(make));
        Model = Guard.Required(model, 1, 60, nameof(model));
    }

    public Vin Vin { get; }

    public string Registration { get; }

    public string Make { get; }

    public string Model { get; }

    /// <summary>Masked like the anonymous reads: the domain VIN mask and the whole-registration mask, never the stored plate.</summary>
    public override string ToString() => $"{Vin.Masked} {MaskedRegistration} {Make} {Model}";
}

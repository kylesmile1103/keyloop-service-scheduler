namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

public sealed record VehicleDetails
{
    public VehicleDetails(Vin vin, string registration, string make, string model)
    {
        ArgumentNullException.ThrowIfNull(vin);
        Vin = vin;
        Registration = Text.Required(registration, 1, 16, nameof(registration)).ToUpperInvariant();
        Make = Text.Required(make, 1, 60, nameof(make));
        Model = Text.Required(model, 1, 60, nameof(model));
    }

    public Vin Vin { get; }

    public string Registration { get; }

    public string Make { get; }

    public string Model { get; }

    public override string ToString() => $"{Vin.Masked} {Registration} {Make} {Model}";
}

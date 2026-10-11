using System.Text.RegularExpressions;

namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

public sealed partial record Vin
{
    private Vin(string value) => Value = value;

    public string Value { get; }

    public string Masked => "***********" + Value[^6..];

    public static bool TryCreate(string? raw, out Vin vin)
    {
        var normalised = raw?.Trim().ToUpperInvariant();
        if (normalised is not null && VinPattern().IsMatch(normalised))
        {
            vin = new Vin(normalised);
            return true;
        }

        vin = null!;
        return false;
    }

    public static Vin Create(string raw) =>
        TryCreate(raw, out var vin) ? vin : throw new ArgumentException("Invalid VIN", nameof(raw));

    [GeneratedRegex("^[A-HJ-NPR-Z0-9]{17}$", RegexOptions.CultureInvariant)]
    private static partial Regex VinPattern();
}

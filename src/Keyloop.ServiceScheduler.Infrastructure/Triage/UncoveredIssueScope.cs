using System.Collections.Frozen;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>
/// Maps service codes to uncovered-issue categories that the service already addresses so redundant secondary-booking notices are suppressed.
/// </summary>
public static class UncoveredIssueScope
{
    internal static readonly FrozenDictionary<string, FrozenSet<string>> Covered = new Dictionary<string, FrozenSet<string>>(StringComparer.Ordinal)
    {
        ["ACCIDENT-DAMAGE-ASSESSMENT"] = new[] { "ACCIDENT_OR_BODY_DAMAGE" }.ToFrozenSet(StringComparer.Ordinal),
        ["AIRCON-REGAS"] = new[] { "AIR_CONDITIONING" }.ToFrozenSet(StringComparer.Ordinal),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>Whether <paramref name="category"/> lies inside the scope of the service Clef chose (<paramref name="serviceCode"/>).</summary>
    public static bool Covers(string serviceCode, string category) =>
        Covered.TryGetValue(serviceCode, out var covered) && covered.Contains(category);
}

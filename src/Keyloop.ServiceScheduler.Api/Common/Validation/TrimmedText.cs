namespace Keyloop.ServiceScheduler.Api.Common.Validation;

/// <summary>Trimmed string length checks for request validators.</summary>
internal static class TrimmedText
{
    /// <summary>Whether <paramref name="value"/> is non-null and its trimmed length is within [<paramref name="min"/>, <paramref name="max"/>].</summary>
    public static bool HasLength(string? value, int min, int max) => value?.Trim().Length is { } length && length >= min && length <= max;
}

namespace Keyloop.ServiceScheduler.Api.Common.Validation;

/// <summary>
/// Text rules for request validators, measured as the domain measures them: after trimming (<c>Guard.Required</c>), so a value a
/// validator accepts always constructs the domain object, and a request never reaches a handler only to fail there as a 500.
/// </summary>
internal static class TrimmedText
{
    /// <summary>Whether <paramref name="value"/> is non-null and its trimmed length is within [<paramref name="min"/>, <paramref name="max"/>].</summary>
    public static bool HasLength(string? value, int min, int max) => value?.Trim().Length is { } length && length >= min && length <= max;
}

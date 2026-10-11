namespace Keyloop.ServiceScheduler.Api.Domain.Common;

internal static class Guard
{
    public static string Required(string? value, int min, int max, string paramName)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length < min || trimmed.Length > max)
        {
            throw new ArgumentException($"{paramName} must be between {min} and {max} characters.", paramName);
        }

        return trimmed;
    }

    /// <summary>Rejects <see cref="DateTimeKind.Local"/> and <see cref="DateTimeKind.Unspecified"/> instants (SYSTEM_DESIGN §6.4: UTC everywhere).</summary>
    public static DateTime Utc(DateTime value, string paramName) =>
        value.Kind == DateTimeKind.Utc
            ? value
            : throw new ArgumentException($"{paramName} must be a UTC DateTime (Kind was {value.Kind}).", paramName);
}

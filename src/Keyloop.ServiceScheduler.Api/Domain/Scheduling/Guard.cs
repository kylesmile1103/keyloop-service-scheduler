namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

internal static class Text
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
}

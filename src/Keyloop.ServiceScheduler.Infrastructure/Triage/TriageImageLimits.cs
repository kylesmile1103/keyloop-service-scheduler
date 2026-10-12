namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

public static class TriageImageLimits
{
    public const int MaxImages = 4;
    public const int MaxImageBytes = 4 * 1024 * 1024;
    public const int MaxTotalImageBytes = 8 * 1024 * 1024;
    public const int MaxUploadBodyBytes = 6 * 1024 * 1024;
    public const int MaxPixels = 16_000_000;
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(1);
}

/// <summary>Safe, field-specific input failure; neither the image nor provider errors belong in its message.</summary>
public sealed class TriageInputException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

public sealed record StoredTriageImage(string ContentType, byte[] Bytes, DateTimeOffset ExpiresAt);

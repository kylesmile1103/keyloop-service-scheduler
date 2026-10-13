using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Constants and validation for the booking endpoint's <c>Idempotency-Key</c> and <c>Idempotent-Replayed</c> headers.
/// </summary>
public static class IdempotencyKeyHeader
{
    public const string Name = "Idempotency-Key";

    public const string ReplayedName = "Idempotent-Replayed";

    /// <summary>Validation pattern for OpenAPI documentation.</summary>
    public const string Pattern = "^[A-Za-z0-9_-]{1,64}$";

    public const int MaxLength = IdempotencyKey.MaxKeyLength;

    /// <summary>OpenAPI description for the <c>Idempotency-Key</c> header parameter.</summary>
    public const string Description =
        "Optional; makes retries safe. 1 to 64 characters of letters, digits, '-' and '_' (a UUID works). The same key with the same body "
        + "within 24 hours of a successful booking replays its 201 (with Idempotent-Replayed: true) and books nothing; the same key with a "
        + "different body is a 422 idempotency-key-reuse. Failed bookings are not stored, so they can be retried with the same key.";

    public const string InvalidMessage = "Idempotency-Key must be 1 to 64 characters: letters, digits, '-' and '_' (a UUID works).";

    /// <summary>Null when <paramref name="key"/> is absent or well-formed; otherwise the validation message.</summary>
    public static string? Validate(string? key) =>
        key is null || (key.Length is >= 1 and <= MaxLength && key.All(IsAllowed)) ? null : InvalidMessage;

    private static bool IsAllowed(char c) => char.IsAsciiLetterOrDigit(c) || c is '-' or '_';
}

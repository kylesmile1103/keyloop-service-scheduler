using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// The booking endpoint's idempotency headers (ARCHITECTURE §7.5). The request's optional <c>Idempotency-Key</c> is 1 to 64
/// characters of <c>[A-Za-z0-9_-]</c> (a UUID fits); anything else, including an empty value or two headers (which arrive joined by a
/// comma), is a 400 <c>validation-error</c> keyed <see cref="Name"/>. A replayed response carries <see cref="ReplayedName"/>: <c>true</c>.
/// </summary>
public static class IdempotencyKeyHeader
{
    public const string Name = "Idempotency-Key";

    public const string ReplayedName = "Idempotent-Replayed";

    /// <summary>The rule as an ECMAScript pattern, for the OpenAPI document; <see cref="Validate"/> applies it without a regex.</summary>
    public const string Pattern = "^[A-Za-z0-9_-]{1,64}$";

    public const int MaxLength = IdempotencyKey.MaxKeyLength;

    /// <summary>The header parameter's OpenAPI description (a <c>[Description]</c>: the XML-comment generator matches <c>&lt;param&gt;</c> by C# name, not by header name).</summary>
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

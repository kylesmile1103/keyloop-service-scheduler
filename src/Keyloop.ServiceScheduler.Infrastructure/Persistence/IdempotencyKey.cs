namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Memoised successful booking response keyed by <c>Idempotency-Key</c>.
/// </summary>
public sealed class IdempotencyKey
{
    public const int MaxKeyLength = 64;

    public required string Key { get; init; }

    /// <summary>SHA-256 of the dealership id and the canonical request body.</summary>
    public required string RequestFingerprint { get; init; }

    public required int ResponseStatus { get; init; }

    /// <summary>The response body as JSON (a <c>jsonb</c> column).</summary>
    public required string ResponseBody { get; init; }

    /// <summary>The created resource (the appointment), when there is one.</summary>
    public Guid? ResourceId { get; init; }

    public required DateTime CreatedAtUtc { get; init; }

    /// <summary>Purge horizon (24 h after creation); indexed for the purge job.</summary>
    public required DateTime ExpiresAtUtc { get; init; }
}

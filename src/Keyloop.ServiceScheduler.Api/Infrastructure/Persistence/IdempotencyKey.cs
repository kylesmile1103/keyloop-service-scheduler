namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;

/// <summary>
/// A memoised successful booking response for an <c>Idempotency-Key</c> (SYSTEM_DESIGN §7.5). The key is the primary key
/// (<c>pk_idempotency_keys</c>), so a concurrent duplicate fails with 23505 and is replayed or rejected by the handler.
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

    /// <summary>Purge horizon (24 h after creation); indexed for the purge job (SYSTEM_DESIGN §17).</summary>
    public required DateTime ExpiresAtUtc { get; init; }
}

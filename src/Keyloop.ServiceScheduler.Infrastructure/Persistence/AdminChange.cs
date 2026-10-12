namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>Append-only, bounded snapshots of Admin edits. No appointment or visitor free text.</summary>
public sealed class AdminChange
{
    public Guid Id { get; init; }
    public Guid DealershipId { get; init; }
    public string ResourceKind { get; init; } = string.Empty;
    public Guid ResourceId { get; init; }
    public string Action { get; init; } = string.Empty;
    public string Actor { get; init; } = string.Empty;
    public DateTime AtUtc { get; init; }
    public string? Before { get; init; }
    public string After { get; init; } = string.Empty;
}

/// <summary>Immutable version marker, including policies with zero rules. Bookings never write this table.</summary>
public sealed class RequirementPolicyVersion
{
    public Guid DealershipId { get; init; }
    public int Version { get; init; }
}

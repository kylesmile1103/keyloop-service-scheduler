namespace Keyloop.ServiceScheduler.Api.Common.Problems;

// Application-level outcomes thrown by handlers and mapped to problems by GlobalExceptionHandler (the only mapper). Domain rule
// violations and illegal transitions are the domain's own exceptions (Domain/Common).

/// <summary>
/// 404 <c>not-found</c>. <see cref="Resource"/> is one of the <see cref="ProblemResources"/> tokens (e.g.
/// <see cref="ProblemResources.Dealership"/>), the <c>resource</c> extension clients branch on; <see cref="Id"/> is the id asked for.
/// </summary>
public sealed class NotFoundException(string resource, Guid id) : Exception($"No {resource} with id '{id}' exists.")
{
    public string Resource { get; } = resource;

    public Guid Id { get; } = id;
}

/// <summary>409 <c>slot-unavailable</c>: every qualified bay or technician is busy at the requested time (pre-check).</summary>
public sealed class SlotUnavailableException(IReadOnlyList<SuggestedSlot> suggestions)
    : Exception("No compatible bay and certified technician are free at the requested time.")
{
    public IReadOnlyList<SuggestedSlot> Suggestions { get; } = suggestions;
}

/// <summary>
/// 409 <c>slot-conflict</c>: the database overlap constraint fired (backstop). <see cref="ConflictingResource"/> is
/// <see cref="ProblemResources.Bay"/> or <see cref="ProblemResources.Technician"/> (<see cref="ProblemResources.Unknown"/> for a deadlock).
/// </summary>
public sealed class SlotConflictException(string conflictingResource, IReadOnlyList<SuggestedSlot> suggestions)
    : Exception("The slot was taken by a concurrent booking.")
{
    public string ConflictingResource { get; } = conflictingResource;

    public IReadOnlyList<SuggestedSlot> Suggestions { get; } = suggestions;
}

/// <summary>422 <c>idempotency-key-reuse</c>: the same <c>Idempotency-Key</c> arrived with a different request body.</summary>
public sealed class IdempotencyKeyReuseException() : Exception("The Idempotency-Key was already used with a different request.");

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>404 <c>not-found</c> for a missing resource identified by <see cref="ProblemResources"/> token and id.</summary>
public sealed class NotFoundException(string resource, Guid id) : Exception($"No {resource} with id '{id}' exists.")
{
    public string Resource { get; } = resource;

    public Guid Id { get; } = id;
}

/// <summary>409 <c>slot-unavailable</c>: every qualified bay or technician is busy at the requested time.</summary>
public sealed class SlotUnavailableException(IReadOnlyList<SuggestedSlot> suggestions)
    : Exception("No compatible bay and certified technician are free at the requested time.")
{
    public IReadOnlyList<SuggestedSlot> Suggestions { get; } = suggestions;
}

/// <summary>409 <c>slot-conflict</c>: a concurrent booking claimed the bay or technician at the database constraint level.</summary>
public sealed class SlotConflictException(string conflictingResource, IReadOnlyList<SuggestedSlot> suggestions)
    : Exception("The slot was taken by a concurrent booking.")
{
    public string ConflictingResource { get; } = conflictingResource;

    public IReadOnlyList<SuggestedSlot> Suggestions { get; } = suggestions;
}

/// <summary>422 <c>idempotency-key-reuse</c>: the same <c>Idempotency-Key</c> arrived with a different request body.</summary>
public sealed class IdempotencyKeyReuseException() : Exception("The Idempotency-Key was already used with a different request.");

/// <summary>409 <c>policy-preview-outdated</c>: publication no longer matches the preview the Admin confirmed.</summary>
public sealed class PolicyPreviewOutdatedException()
    : Exception("The roster or date consequences changed since the preview. Run the preview again before publishing.");

/// <summary>409 <c>concurrency-conflict</c>: repeated policy publications exhausted this booking's re-resolution budget.</summary>
public sealed class BookingPolicyChurnException()
    : Exception("The requirement policy changed repeatedly while this booking was being prepared. Refresh availability and retry the booking.");

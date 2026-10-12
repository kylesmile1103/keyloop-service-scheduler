namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

/// <summary>A customer's untrusted booking intake description, never stored or logged.</summary>
public sealed record TriageBookingRequest(string Description, Guid[]? ImageIds = null)
{
    /// <summary>The issue and optional preferred date, 1 to the configured maximum (500 by default) characters after trimming.</summary>
    /// <example>Brakes squeal, it's an EV, need it Thursday.</example>
    public string Description { get; init; } = Description;

    /// <summary>Optional photos: at most four distinct, unexpired UploadBookingTriageImage ids from this dealership, at most 8 MiB decoded in total.</summary>
    public Guid[]? ImageIds { get; init; } = ImageIds;
}

namespace Keyloop.ServiceScheduler.Api.Common.Contracts;

/// <summary>A bay or a technician, by id and display name.</summary>
/// <param name="Id">The resource's id (usable as <c>preferredBayId</c> or <c>preferredTechnicianId</c> on a later booking).</param>
/// <param name="Name">Display name.</param>
public sealed record ResourceSummary(Guid Id, string Name);

namespace Keyloop.ServiceScheduler.Api.Common.Contracts;

// A wire record shared by more than one feature family (SYSTEM_DESIGN §8.4): the appointment and workshop-schedule responses,
// so the contract has one ResourceSummary schema and the generated client one type.

/// <summary>A bay or a technician, by id and display name.</summary>
/// <param name="Id">The resource's id (usable as <c>preferredBayId</c> or <c>preferredTechnicianId</c> on a later booking).</param>
/// <param name="Name">Display name.</param>
public sealed record ResourceSummary(Guid Id, string Name);

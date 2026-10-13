namespace Keyloop.ServiceScheduler.Api.Common.Contracts;

/// <summary>The booked service, as the catalogue lists it.</summary>
/// <param name="Id">The service type's id.</param>
/// <param name="Code">Stable upper-kebab identifier (e.g. <c>INTERIM-SERVICE</c>).</param>
/// <param name="Name">Display name.</param>
/// <param name="DurationMinutes">How long the bay and the technician are reserved, in minutes.</param>
public sealed record ServiceTypeSummary(Guid Id, string Code, string Name, int DurationMinutes);

using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;

/// <summary>A catalogue entry: how long the service takes, what it needs, and whether the dealership in the route can perform it.</summary>
/// <param name="Id">The service type's id, used when asking for availability and booking.</param>
/// <param name="Code">Stable upper-kebab identifier, unique across the catalogue (e.g. <c>EV-BATTERY-CHECK</c>).</param>
/// <param name="Name">Display name.</param>
/// <param name="DurationMinutes">How long the service occupies one bay and one technician, in minutes (a multiple of 5).</param>
/// <param name="RequiredBayCapabilities">Capabilities the bay must have, all of them, in the enumeration's declared order.</param>
/// <param name="RequiredCertifications">Certifications the technician must hold, all of them, in the enumeration's declared order.</param>
/// <param name="Bookable">
/// True when the dealership has at least one active bay with every required capability and at least one active technician with
/// every required certification when vehicle-aware requirements are off. When on, some powertrain/class profile the booking dialog
/// can submit must satisfy the latest dealership policy on today's dealership-local date, including inclusive HV expiry, without
/// requiring the legacy HV certificate. Busy time, opening hours and the booking window are excluded; availability checks the chosen
/// vehicle and appointment date.
/// </param>
public sealed record ServiceTypeResponse(
    Guid Id,
    string Code,
    string Name,
    int DurationMinutes,
    IReadOnlyList<BayCapability> RequiredBayCapabilities,
    IReadOnlyList<Certification> RequiredCertifications,
    bool Bookable);

using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary>
/// The dispatch board for one dealership on one local date: every bay with the appointments it hosts that day, and every technician.
/// A projection over the day's appointments (ARCHITECTURE §5.3); it is a snapshot, and booking checks again.
/// </summary>
/// <param name="Dealership">The dealership, with the time zone every <c>…Local</c> value is expressed in.</param>
/// <param name="Date">The local calendar date asked for, in the dealership's time zone.</param>
/// <param name="OperatingWindow">Opening to closing time that day; null when the dealership is closed on that weekday, and every bay's <c>appointments</c> is then empty.</param>
/// <param name="SlotGranularityMinutes">Bookable start times fall on this grid, counted from the opening time: the natural column width of a timeline.</param>
/// <param name="Bays">Every bay of the dealership, active or not, ordered by name, each with its appointments that day.</param>
/// <param name="Technicians">Every technician of the dealership, active or not, ordered by name. Each appointment's <c>technician.id</c> is one of them.</param>
public sealed record WorkshopScheduleResponse(
    DealershipSummary Dealership,
    DateOnly Date,
    OperatingWindowResponse? OperatingWindow,
    int SlotGranularityMinutes,
    IReadOnlyList<BayScheduleResponse> Bays,
    IReadOnlyList<TechnicianResponse> Technicians);

/// <summary>The dealership a schedule belongs to.</summary>
/// <param name="Id">The dealership's id.</param>
/// <param name="Name">Display name.</param>
/// <param name="TimeZoneId">IANA time-zone id (e.g. <c>Europe/London</c>); every <c>…Local</c> value in the schedule is wall-clock time there, with that zone's offset.</param>
public sealed record DealershipSummary(Guid Id, string Name, string TimeZoneId);

/// <summary>A service bay, a lane of the board, with the appointments it hosts that day.</summary>
/// <param name="Id">The bay's id (usable as <c>preferredBayId</c> on a booking).</param>
/// <param name="Name">Display name.</param>
/// <param name="Capabilities">What the bay is equipped for, in the enumeration's declared order.</param>
/// <param name="IsActive">False when the bay is out of service: it takes no new bookings, but the appointments it already holds stay listed under it.</param>
/// <param name="Appointments">
/// Its appointments overlapping that day's opening hours, in every status except <c>Cancelled</c>, ordered by start. Empty when
/// the dealership is closed that day.
/// </param>
public sealed record BayScheduleResponse(
    Guid Id, string Name, IReadOnlyList<BayCapability> Capabilities, bool IsActive, IReadOnlyList<ScheduledAppointmentResponse> Appointments);

/// <summary>A technician on the dealership's roster: a lane of the board when it is viewed by technician.</summary>
/// <param name="Id">The technician's id (usable as <c>preferredTechnicianId</c> on a booking); appointments name it in <c>technician.id</c>.</param>
/// <param name="Name">Display name.</param>
/// <param name="EmployeeNumber">The dealership's employee number for the technician, unique within the dealership.</param>
/// <param name="Certifications">What the technician is certified to perform, in the enumeration's declared order.</param>
/// <param name="IsActive">False when the technician takes no new bookings; appointments made before still name them.</param>
/// <param name="HvLevel">Vehicle-aware competence level 0..4; absent when the flag is off or the caller has no API role (the four competence fields are employee data).</param>
/// <param name="HvLevelValidUntil">Inclusive local-date expiry; omitted when unlimited or the flag is off.</param>
/// <param name="HvLevelConfirmed">False includes migrated levels, which still count.</param>
/// <param name="BrandSpecialisms">Normalized OEM codes; data only in Phase 1.</param>
public sealed record TechnicianResponse(Guid Id, string Name, string EmployeeNumber, IReadOnlyList<Certification> Certifications, bool IsActive,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? HvLevel = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateOnly? HvLevelValidUntil = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? HvLevelConfirmed = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? BrandSpecialisms = null);

/// <summary>An appointment on the board: when it runs, what it is, who works on it, and for which vehicle and customer.</summary>
/// <param name="Id">The appointment's id; <c>GET /api/v1/appointments/{id}</c> has the whole record (contact details, make and model, notes).</param>
/// <param name="StartUtc">Start (inclusive), UTC.</param>
/// <param name="EndUtc">End (exclusive), UTC.</param>
/// <param name="StartLocal">Start as the dealership's local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c> (e.g. <c>2026-10-13T10:00+01:00</c>), for display.</param>
/// <param name="EndLocal">End as the dealership's local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, for display.</param>
/// <param name="Status">
/// Lifecycle state: <c>Confirmed</c>, <c>CheckedIn</c> or <c>InProgress</c>, which hold the bay and the technician, or <c>Completed</c>
/// or <c>NoShow</c>. Cancelled appointments are not on the board.
/// </param>
/// <param name="ServiceType">The booked service.</param>
/// <param name="Technician">The technician reserved for it, one of the schedule's <c>technicians</c>.</param>
/// <param name="Vin">The vehicle's 17-character VIN, upper case, for callers with an API role; every other caller receives eleven asterisks and its last six characters, for example <c>***********123456</c>.</param>
/// <param name="Registration">The vehicle's registration plate, upper case, for callers with an API role; every other caller receives it fully masked as <c>*******</c>, whatever the plate, so no character or length is revealed.</param>
/// <param name="CompetenceWarning">Computed review flag and bounded reason codes against recorded requirements, present only with the vehicle-aware flag and an API role.</param>
/// <param name="CustomerName">The customer's name. Callers with an API role (Admin, ServiceAdvisor or Viewer) receive it in full; every other caller receives one upper-case initial per whitespace-separated part, from its first letter, for example <c>ALS</c> for Alice Louise Smith.</param>
public sealed record ScheduledAppointmentResponse(
    Guid Id,
    DateTime StartUtc,
    DateTime EndUtc,
    string StartLocal,
    string EndLocal,
    AppointmentStatus Status,
    ServiceTypeSummary ServiceType,
    ResourceSummary Technician,
    string Vin,
    string Registration,
    string CustomerName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Appointments.Shared.CompetenceWarningResponse? CompetenceWarning = null);

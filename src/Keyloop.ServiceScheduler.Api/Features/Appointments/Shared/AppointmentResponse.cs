using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

/// <summary>An appointment: one service for one vehicle, with the bay and the technician reserved for it over the same time slot.</summary>
/// <param name="Id">The appointment's id; <c>Location</c> of a booking points at <c>/api/v1/appointments/{id}</c>.</param>
/// <param name="DealershipId">The dealership whose bay and technician are reserved.</param>
/// <param name="ServiceType">The service booked.</param>
/// <param name="Bay">The service bay reserved for the whole slot (chosen by the allocation policy unless a preferred free one was given).</param>
/// <param name="Technician">The technician reserved for the whole slot.</param>
/// <param name="StartUtc">Start (inclusive), UTC.</param>
/// <param name="EndUtc">End (exclusive), UTC: the start plus the service duration.</param>
/// <param name="StartLocal">Start as the dealership's local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c> (e.g. <c>2026-10-13T10:00+01:00</c>), for display.</param>
/// <param name="EndLocal">End as the dealership's local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, for display.</param>
/// <param name="Status">Lifecycle state: <c>Confirmed</c> when booked; <c>CheckedIn</c>, <c>InProgress</c>, <c>Completed</c>, <c>Cancelled</c> or <c>NoShow</c> later.</param>
/// <param name="Customer">Who the appointment is for.</param>
/// <param name="Vehicle">The vehicle to be serviced.</param>
/// <param name="Notes">Free-text notes from booking, trimmed; null when none were given.</param>
/// <param name="CancellationReason">Why the appointment was cancelled; null unless <c>status</c> is <c>Cancelled</c>.</param>
/// <param name="CreatedAtUtc">When it was booked, UTC.</param>
/// <param name="CompetenceWarning">Read-time review warning against recorded requirements for active appointments; omitted when clean or disabled.</param>
/// <param name="Allocation">Vehicle-aware decision, policy version and fired rules. Absent on legacy bookings.</param>
/// <param name="UpdatedAtUtc">When its status last changed, UTC (the booking time until then).</param>
public sealed record AppointmentResponse(
    Guid Id,
    Guid DealershipId,
    ServiceTypeSummary ServiceType,
    ResourceSummary Bay,
    ResourceSummary Technician,
    DateTime StartUtc,
    DateTime EndUtc,
    string StartLocal,
    string EndLocal,
    AppointmentStatus Status,
    CustomerResponse Customer,
    VehicleResponse Vehicle,
    string? Notes,
    string? CancellationReason,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AllocationDecision? Allocation = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CompetenceWarningResponse? CompetenceWarning = null);

/// <summary>The customer's contact details as booked.</summary>
/// <param name="Name">Full name, trimmed.</param>
/// <param name="Email">Email address, trimmed.</param>
/// <param name="Phone">Phone number, trimmed.</param>
public sealed record CustomerResponse(string Name, string Email, string Phone);

/// <summary>The vehicle as booked.</summary>
/// <param name="Profile">Resolved facts and server-assigned provenance, present on vehicle-aware bookings.</param>
/// <param name="Vin">The 17-character VIN, upper case.</param>
/// <param name="Registration">Registration plate, upper case.</param>
/// <param name="Make">Manufacturer.</param>
/// <param name="Model">Model.</param>
public sealed record VehicleResponse(string Vin, string Registration, string Make, string Model,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] VehicleProfile? Profile = null);

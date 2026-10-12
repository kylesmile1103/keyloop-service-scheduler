using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

/// <summary>An appointment selected by its local start date, with its service and allocated resources.</summary>
/// <param name="Id">The appointment id; <c>GET /api/v1/appointments/{id}</c> reads the whole record.</param>
/// <param name="Status">Lifecycle status, including cancelled and no-show appointments.</param>
/// <param name="StartUtc">Inclusive start in UTC, for example <c>2026-10-13T08:00:00Z</c>.</param>
/// <param name="EndUtc">Exclusive end in UTC.</param>
/// <param name="StartLocal">Start in the dealership's time zone with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, for example <c>2026-10-13T09:00+01:00</c>.</param>
/// <param name="EndLocal">End in the dealership's time zone with offset; may fall outside the requested date range.</param>
/// <param name="ServiceType">The booked service's id, code, name and duration in minutes.</param>
/// <param name="Bay">The allocated bay's id and display name.</param>
/// <param name="Technician">The allocated technician's id and display name.</param>
/// <param name="CustomerName">The customer's name. Callers with an API role (Admin, ServiceAdvisor or Viewer) receive it in full; every other caller receives one upper-case initial per whitespace-separated part, from its first letter, for example <c>ALS</c> for Alice Louise Smith.</param>
/// <param name="Vin">The vehicle's 17-character VIN, upper case, for callers with an API role; every other caller receives eleven asterisks and its last six characters, for example <c>***********123456</c>.</param>
/// <param name="Registration">The vehicle's registration plate, upper case, for callers with an API role; every other caller receives <c>****</c> and its last three letters or digits, for example <c>****CDE</c> for AB12 CDE, or <c>*******</c> for a plate with fewer than six.</param>
public sealed record AppointmentListItemResponse(
    Guid Id,
    AppointmentStatus Status,
    DateTime StartUtc,
    DateTime EndUtc,
    string StartLocal,
    string EndLocal,
    ServiceTypeSummary ServiceType,
    ResourceSummary Bay,
    ResourceSummary Technician,
    string CustomerName,
    string Vin,
    string Registration);

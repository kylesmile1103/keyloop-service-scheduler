using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>
/// Source-generated JSON metadata for every type the API serialises (ADR-016, Addendum A §A2). Reflection-based serialisation is
/// disabled, so a type missing here fails fast. It is first in the HTTP resolver chain; ASP.NET Core's ProblemDetails context follows.
/// </summary>
/// <remarks>
/// ProblemDetails extensions are <c>object</c>-typed and serialised by their <em>runtime</em> type, so each runtime type a throw
/// site stores there is listed (a <c>List&lt;T&gt;</c> is not covered by <c>T[]</c>; <c>GlobalExceptionHandler</c> copies
/// suggestions into arrays). Top-level collection response types are listed explicitly, as the endpoint declares them
/// (<c>Ok&lt;IReadOnlyList&lt;T&gt;&gt;</c> → <c>IReadOnlyList&lt;T&gt;</c>): the HTTP writer serialises a declared collection type with
/// its own metadata whatever list the handler returns (<c>List&lt;T&gt;</c>, an array, a collection expression), so the runtime
/// list type needs no entry. Nested types are discovered.
/// </remarks>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    UseStringEnumConverter = true,
    WriteIndented = false)]
// Task 7: problem extension values (SYSTEM_DESIGN §8.7), by runtime type
[JsonSerializable(typeof(OperatingWindow))] // operatingWindow
[JsonSerializable(typeof(DateTime))] // earliestStartUtc, latestStartUtc
[JsonSerializable(typeof(int))] // slotGranularityMinutes, retryAfterSeconds
[JsonSerializable(typeof(BayCapability[]))] // missingCapabilities
[JsonSerializable(typeof(Certification[]))] // missingCertifications
[JsonSerializable(typeof(SuggestedSlot))]
[JsonSerializable(typeof(SuggestedSlot[]))] // suggestedSlots
[JsonSerializable(typeof(IReadOnlyList<SuggestedSlot>))]
[JsonSerializable(typeof(AppointmentStatus))] // currentStatus
[JsonSerializable(typeof(string))] // attempted, resource, conflictingResource, traceId
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(Guid))] // id
// Task 8: dealerships and the service catalogue
[JsonSerializable(typeof(DealershipResponse))]
[JsonSerializable(typeof(DayOperatingHoursResponse))]
[JsonSerializable(typeof(IReadOnlyList<DealershipResponse>))]
[JsonSerializable(typeof(ServiceTypeResponse))]
[JsonSerializable(typeof(IReadOnlyList<ServiceTypeResponse>))]
// Task 9: availability
[JsonSerializable(typeof(AvailabilityResponse))]
[JsonSerializable(typeof(OperatingWindowResponse))]
[JsonSerializable(typeof(AvailabilitySlotResponse))]
[JsonSerializable(typeof(IReadOnlyList<AvailabilitySlotResponse>))]
[JsonSerializable(typeof(DateOnly))] // date (the schedule's too, Task 12); the localDate extension of a closed-day outside-operating-hours
[JsonSerializable(typeof(Guid?))] // the serviceTypeId query parameter: the OpenAPI document builds parameter schemas through this resolver too
// Task 10: booking (the request and the appointment response, which is also the memoised idempotency body)
[JsonSerializable(typeof(BookAppointmentRequest))]
[JsonSerializable(typeof(CustomerRequest))]
[JsonSerializable(typeof(VehicleRequest))]
[JsonSerializable(typeof(AppointmentResponse))]
[JsonSerializable(typeof(ServiceTypeSummary))]
[JsonSerializable(typeof(ResourceSummary))]
[JsonSerializable(typeof(CustomerResponse))]
[JsonSerializable(typeof(VehicleResponse))]
// Task 11: cancellation (GetAppointment and CancelAppointment answer with AppointmentResponse, registered above)
[JsonSerializable(typeof(CancelAppointmentRequest))]
// Task 12: the workshop schedule. Nested records and lists are discovered from the response; they are listed so every wire type
// is visible here (OperatingWindowResponse, ServiceTypeSummary, ResourceSummary and DateOnly are registered above).
[JsonSerializable(typeof(WorkshopScheduleResponse))]
[JsonSerializable(typeof(DealershipSummary))]
[JsonSerializable(typeof(BayScheduleResponse))]
[JsonSerializable(typeof(IReadOnlyList<BayScheduleResponse>))]
[JsonSerializable(typeof(ScheduledAppointmentResponse))]
[JsonSerializable(typeof(IReadOnlyList<ScheduledAppointmentResponse>))]
[JsonSerializable(typeof(TechnicianResponse))]
[JsonSerializable(typeof(IReadOnlyList<TechnicianResponse>))]
[JsonSerializable(typeof(IReadOnlyList<BayCapability>))]
[JsonSerializable(typeof(IReadOnlyList<Certification>))]
// Task 14b: the demo reseed command's answer (outside the OpenAPI contract, read by the Aspire dashboard).
[JsonSerializable(typeof(ReseedDemoDataResponse))]
// Tasks 13+: every request, response and extension payload type, including top-level collections.
internal sealed partial class SchedulerJsonContext : JsonSerializerContext;

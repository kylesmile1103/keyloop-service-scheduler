using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Api.Features.Admin.History;

using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Api.Features.Identity.GetCurrentUser;
using Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Api.Features.Triage.UploadBookingTriageImage;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>Source-generated JSON serialization context for API contracts and problem extension values.</summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    UseStringEnumConverter = true,
    WriteIndented = false)]
[JsonSerializable(typeof(OperatingWindow))]
[JsonSerializable(typeof(DateTime))]
[JsonSerializable(typeof(int))]
[JsonSerializable(typeof(BayCapability[]))]
[JsonSerializable(typeof(Certification[]))]
[JsonSerializable(typeof(SuggestedSlot))]
[JsonSerializable(typeof(SuggestedSlot[]))]
[JsonSerializable(typeof(IReadOnlyList<SuggestedSlot>))]
[JsonSerializable(typeof(AppointmentStatus))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(Guid))]
[JsonSerializable(typeof(DealershipResponse))]
[JsonSerializable(typeof(DayOperatingHoursResponse))]
[JsonSerializable(typeof(IReadOnlyList<DealershipResponse>))]
[JsonSerializable(typeof(ServiceTypeResponse))]
[JsonSerializable(typeof(IReadOnlyList<ServiceTypeResponse>))]
[JsonSerializable(typeof(AvailabilityResponse))]
[JsonSerializable(typeof(OperatingWindowResponse))]
[JsonSerializable(typeof(AvailabilitySlotResponse))]
[JsonSerializable(typeof(IReadOnlyList<AvailabilitySlotResponse>))]
[JsonSerializable(typeof(DateOnly))]
[JsonSerializable(typeof(bool?))]
[JsonSerializable(typeof(Guid?))]
[JsonSerializable(typeof(VehicleProfile))]
[JsonSerializable(typeof(ProfileProvenance))]
[JsonSerializable(typeof(VehicleProfileRequest))]
[JsonSerializable(typeof(ResolveVehicleProfileRequest))]
[JsonSerializable(typeof(AllocationDecision))]
[JsonSerializable(typeof(BookAppointmentRequest))]
[JsonSerializable(typeof(CustomerRequest))]
[JsonSerializable(typeof(VehicleRequest))]
[JsonSerializable(typeof(AppointmentResponse))]
[JsonSerializable(typeof(ServiceTypeSummary))]
[JsonSerializable(typeof(ResourceSummary))]
[JsonSerializable(typeof(CustomerResponse))]
[JsonSerializable(typeof(VehicleResponse))]
[JsonSerializable(typeof(CancelAppointmentRequest))]
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
[JsonSerializable(typeof(ReseedDemoDataResponse))]
[JsonSerializable(typeof(BookingTriageStatusResponse))]
[JsonSerializable(typeof(TriageBookingRequest))]
[JsonSerializable(typeof(TriageBookingResponse))]
[JsonSerializable(typeof(TriageServiceCandidate))]
[JsonSerializable(typeof(TriagePreferredDate))]
[JsonSerializable(typeof(TriageUncoveredIssue))]
[JsonSerializable(typeof(UploadBookingTriageImageRequest))]
[JsonSerializable(typeof(UploadBookingTriageImageResponse))]
[JsonSerializable(typeof(AppointmentListItemResponse))]
[JsonSerializable(typeof(IReadOnlyList<AppointmentListItemResponse>))]
[JsonSerializable(typeof(CurrentUserResponse))]
[JsonSerializable(typeof(FeatureSwitchesResponse))]
[JsonSerializable(typeof(FindReturningCustomersRequest))]
[JsonSerializable(typeof(ReturningCustomerResponse))]
[JsonSerializable(typeof(ReturningCustomerDetails))]
[JsonSerializable(typeof(ReturningVehicleDetails))]
[JsonSerializable(typeof(IReadOnlyList<ReturningCustomerResponse>))]
[JsonSerializable(typeof(Microsoft.AspNetCore.Mvc.ProblemDetails))]
[JsonSerializable(typeof(TechnicianWriteRequest))]
[JsonSerializable(typeof(BayWriteRequest))]
[JsonSerializable(typeof(AdminTechnicianResponse))]
[JsonSerializable(typeof(AdminBayResponse))]
[JsonSerializable(typeof(IReadOnlyList<AdminTechnicianResponse>))]
[JsonSerializable(typeof(IReadOnlyList<AdminBayResponse>))]
[JsonSerializable(typeof(RequirementRuleInput[]))]
[JsonSerializable(typeof(PolicyWriteRequest))]
[JsonSerializable(typeof(AdminPolicyResponse))]
[JsonSerializable(typeof(PolicyEditResponse))]
[JsonSerializable(typeof(PolicyPreviewTokenInput))]
[JsonSerializable(typeof(CompetenceWarningResponse))]
[JsonSerializable(typeof(AdminHistoryResponse))]
internal sealed partial class SchedulerJsonContext : JsonSerializerContext;

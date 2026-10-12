using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

/// <summary>
/// Reflection-based JSON is off in the API (ADR-016) and problem extensions are object-typed, so System.Text.Json resolves each
/// value by its runtime type. These tests collect the values the real domain throw sites put into extensions and require each
/// runtime type to be in <see cref="SchedulerJsonContext"/>; the integration suite then proves the HTTP write path.
/// </summary>
public class SchedulerJsonContextTests
{
    private static readonly DateOnly BookingDay = new(2026, 10, 13); // Tuesday; Europe/London is on BST (UTC+1)
    private static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
    private static readonly FakeTimeProvider Clock = new(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero));
    private static DateTime Now => Clock.GetUtcNow().UtcDateTime;

    [Fact]
    public void Every_extension_value_raised_by_the_domain_serialises_through_the_context()
    {
        var values = DomainExtensionValues();

        values.Keys.ShouldBe(
            ["earliestStartUtc", "latestStartUtc", "slotGranularityMinutes", "missingCapabilities", "missingCertifications", "operatingWindow", "localDate"],
            ignoreOrder: true);
        foreach (var (key, value) in values)
        {
            var runtimeType = value.ShouldNotBeNull().GetType();
            SchedulerJsonContext.Default.GetTypeInfo(runtimeType).ShouldNotBeNull($"'{key}' is a {runtimeType} that SchedulerJsonContext does not list");
        }

        Json(values["earliestStartUtc"]).ShouldBe("\"2026-10-12T09:00:00Z\"");
        Json(values["latestStartUtc"]).ShouldBe("\"2027-01-10T08:00:00Z\"");
        Json(values["slotGranularityMinutes"]).ShouldBe("15");
        Json(values["missingCapabilities"]).ShouldBe("""["EvHighVoltage"]""");
        Json(values["missingCertifications"]).ShouldBe("""["HighVoltageElectrical"]""");
        Json(values["operatingWindow"]).ShouldBe("""{"startUtc":"2026-10-13T07:00:00Z","endUtc":"2026-10-13T17:00:00Z"}""");
        Json(values["localDate"]).ShouldBe("\"2026-10-18\"");
    }

    [Fact]
    public void Invalid_transition_status_serialises_as_its_name()
    {
        var appointment = Book(new TimeOnly(9, 0));
        appointment.Cancel("Customer rescheduled", Now);

        var ex = Should.Throw<InvalidStateTransitionException>(() => appointment.Cancel("Again", Now));

        Json(ex.Current).ShouldBe("\"Cancelled\"");
    }

    [Fact]
    public void Api_extension_value_types_are_registered()
    {
        var slot = new SuggestedSlot(new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), "2026-10-13T09:00+01:00");

        using (var suggestions = JsonDocument.Parse(Json(new[] { slot })))
        {
            var only = suggestions.RootElement.EnumerateArray().ShouldHaveSingleItem();
            only.EnumerateObject().Select(p => p.Name).ShouldBe(["startUtc", "endUtc", "startLocal"]);
            only.GetProperty("startLocal").GetString().ShouldBe("2026-10-13T09:00+01:00"); // the HTTP encoder leaves '+' unescaped
        }

        foreach (var type in new[]
                 {
                     typeof(SuggestedSlot), typeof(SuggestedSlot[]), typeof(IReadOnlyList<SuggestedSlot>), typeof(OperatingWindow), typeof(BayCapability[]),
                     typeof(Certification[]), typeof(AppointmentStatus), typeof(DateTime), typeof(Guid), typeof(int), typeof(string), typeof(string[]),
                 })
        {
            SchedulerJsonContext.Default.GetTypeInfo(type).ShouldNotBeNull(type.ToString());
        }
    }

    [Fact]
    public void Booking_request_and_response_types_are_registered()
    {
        foreach (var type in new[]
                 {
                     typeof(BookAppointmentRequest), typeof(CustomerRequest), typeof(VehicleRequest), typeof(AppointmentResponse), typeof(ServiceTypeSummary),
                     typeof(ResourceSummary), typeof(CustomerResponse), typeof(VehicleResponse), typeof(DateOnly),
                 })
        {
            SchedulerJsonContext.Default.GetTypeInfo(type).ShouldNotBeNull(type.ToString());
        }
    }

    [Fact]
    public void Workshop_schedule_types_are_registered()
    {
        foreach (var type in new[]
                 {
                     typeof(WorkshopScheduleResponse), typeof(DealershipSummary), typeof(BayScheduleResponse), typeof(IReadOnlyList<BayScheduleResponse>),
                     typeof(ScheduledAppointmentResponse), typeof(IReadOnlyList<ScheduledAppointmentResponse>), typeof(TechnicianResponse),
                     typeof(IReadOnlyList<TechnicianResponse>), typeof(IReadOnlyList<BayCapability>), typeof(IReadOnlyList<Certification>),
                     typeof(OperatingWindowResponse), typeof(DateOnly),
                 })
        {
            SchedulerJsonContext.Default.GetTypeInfo(type).ShouldNotBeNull(type.ToString());
        }
    }

    private static Dictionary<string, object?> DomainExtensionValues()
    {
        var values = new Dictionary<string, object?>();
        void Collect(Action throwSite)
        {
            foreach (var (key, value) in Should.Throw<DomainRuleViolationException>(throwSite).Extensions)
            {
                values.Add(key, value);
            }
        }

        var policy = new BookingWindowPolicy(Clock, TimeSpan.FromHours(1), TimeSpan.FromDays(90));
        Collect(() => policy.EnsureBookable(Now));
        Collect(() => policy.EnsureBookable(Now.AddDays(91)));
        Collect(() => BookingWindowPolicy.EnsureAligned(Window.StartUtc.AddMinutes(7), Window, 15));
        Collect(() => Book(new TimeOnly(9, 0), serviceType: EvCheck));
        Collect(() => Book(new TimeOnly(7, 0)));
        Collect(() => BookingWindowPolicy.OperatingWindowFor(Reading, TimeSlot.FromStart(new DateTime(2026, 10, 18, 9, 0, 0, DateTimeKind.Utc), Interim.Duration)));
        return values;
    }

    private static readonly Dealership Reading = Dealership.Create(
        Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc));

    private static readonly OperatingWindow Window = Reading.ResolveOperatingWindow(BookingDay)!.Value;

    private static readonly ServiceType Interim = ServiceType.Create(
        Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(60), [BayCapability.StandardLift], [Certification.GeneralService]);

    private static readonly ServiceType EvCheck = ServiceType.Create(
        Guid.NewGuid(), "EV-BATTERY-CHECK", "EV Battery Check", ServiceDuration.Create(60), [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);

    private static Appointment Book(TimeOnly localStart, ServiceType? serviceType = null)
    {
        var type = serviceType ?? Interim;
        var bay = ServiceBay.Create(Guid.NewGuid(), Reading.Id, "Bay 1", [BayCapability.StandardLift]);
        var technician = Technician.Create(Guid.NewGuid(), Reading.Id, "Amelia Clarke", "T-1001", [Certification.GeneralService]);
        var slot = TimeSlot.FromStart(LocalTimeConverter.ToUtc(BookingDay, localStart, London), type.Duration);
        return Appointment.Book(
            Guid.NewGuid(), Reading, type, bay, technician, slot, Window, new CustomerDetails("Jane Doe", "jane.doe@example.com", "+44 7700 900123"),
            new VehicleDetails(Vin.Create("WVWZZZ1KZAW123456"), "AB12 CDE", "Volkswagen", "Golf"), notes: null, Now);
    }

    private static string Json(object? value) => JsonSerializer.Serialize(value, value!.GetType(), SchedulerJsonContext.Default);
}

using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>Verifies mapping of appointment aggregates and resources to response DTOs with dealership-local times.</summary>
public class AppointmentResponseMapperTests
{
    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    private static readonly Dealership Reading = Dealership.Create(
        Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), Now);

    private static readonly ServiceType Interim = ServiceType.Create(
        Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(90), [BayCapability.StandardLift], [Certification.GeneralService]);

    private static readonly ServiceBay Bay = ServiceBay.Create(Guid.NewGuid(), Reading.Id, "Bay 1", [BayCapability.StandardLift]);

    private static readonly Technician Amelia = Technician.Create(Guid.NewGuid(), Reading.Id, "Amelia Clarke", "T-1001", [Certification.GeneralService]);

    [Fact]
    public void Maps_every_member_with_local_times_in_the_dealership_zone()
    {
        var appointment = Book();

        var response = AppointmentResponseMapper.Map(appointment, London, Interim, Bay, Amelia);

        response.ShouldBe(new AppointmentResponse(
            appointment.Id,
            Reading.Id,
            new ServiceTypeSummary(Interim.Id, "INTERIM-SERVICE", "Interim Service", 90),
            new ResourceSummary(Bay.Id, "Bay 1"),
            new ResourceSummary(Amelia.Id, "Amelia Clarke"),
            new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 10, 13, 10, 30, 0, DateTimeKind.Utc),
            "2026-10-13T10:00+01:00",
            "2026-10-13T11:30+01:00",
            AppointmentStatus.Confirmed,
            new CustomerResponse("Alex Morgan", "alex.morgan@example.com", "+44 7700 900123"),
            new VehicleResponse("WVWZZZ1KZAW123456", "AB12 CDE", "Volkswagen", "Golf"), // the full VIN: the caller supplied it
            "Rattle from the front left wheel.",
            CancellationReason: null,
            Now,
            Now));
    }

    [Fact]
    public void Carries_the_cancellation_reason_and_serialises_with_string_enums()
    {
        var appointment = Book();
        appointment.Cancel("Customer rescheduled", Now.AddHours(1));

        var response = AppointmentResponseMapper.Map(appointment, London, Interim, Bay, Amelia);

        response.Status.ShouldBe(AppointmentStatus.Cancelled);
        response.CancellationReason.ShouldBe("Customer rescheduled");
        response.UpdatedAtUtc.ShouldBe(Now.AddHours(1));
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(response, SchedulerJsonContext.Default.AppointmentResponse));
        json.RootElement.GetProperty("status").GetString().ShouldBe("Cancelled");
        json.RootElement.EnumerateObject().Select(p => p.Name).ShouldBe(
        [
            "id", "dealershipId", "serviceType", "bay", "technician", "startUtc", "endUtc", "startLocal", "endLocal", "status", "customer", "vehicle",
            "notes", "cancellationReason", "createdAtUtc", "updatedAtUtc",
        ]);
    }

    [Fact]
    public void Rejects_resources_that_are_not_the_appointment_s()
    {
        var appointment = Book();
        var otherBay = ServiceBay.Create(Guid.NewGuid(), Reading.Id, "Bay 2", [BayCapability.StandardLift]);
        var otherTechnician = Technician.Create(Guid.NewGuid(), Reading.Id, "Ben Okafor", "T-1002", [Certification.GeneralService]);
        var otherService = ServiceType.Create(
            Guid.NewGuid(), "MOT-TEST", "MOT", ServiceDuration.Create(60), [BayCapability.MotTesting], [Certification.MotTester]);

        Should.Throw<ArgumentException>(() => AppointmentResponseMapper.Map(appointment, London, Interim, otherBay, Amelia)).ParamName.ShouldBe("bay");
        Should.Throw<ArgumentException>(() => AppointmentResponseMapper.Map(appointment, London, Interim, Bay, otherTechnician)).ParamName.ShouldBe("technician");
        Should.Throw<ArgumentException>(() => AppointmentResponseMapper.Map(appointment, London, otherService, Bay, Amelia)).ParamName.ShouldBe("serviceType");
    }

    private static Appointment Book() =>
        Appointment.Book(
            Guid.CreateVersion7(),
            Reading,
            Interim,
            Bay,
            Amelia,
            TimeSlot.FromStart(new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), Interim.Duration),
            Reading.ResolveOperatingWindow(new DateOnly(2026, 10, 13))!.Value,
            new CustomerDetails("Alex Morgan", "alex.morgan@example.com", "+44 7700 900123"),
            new VehicleDetails(Vin.Create("WVWZZZ1KZAW123456"), "AB12 CDE", "Volkswagen", "Golf"),
            "Rattle from the front left wheel.",
            Now);
}

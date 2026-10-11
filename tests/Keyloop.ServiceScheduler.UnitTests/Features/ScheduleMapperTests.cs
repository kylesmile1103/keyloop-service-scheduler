using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Api.Features.Schedule.Mapping;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>The workshop schedule's parts (Mapperly, Addendum A §A6): resources as the board shows them, local times in the dealership's zone.</summary>
public class ScheduleMapperTests
{
    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    private static readonly Dealership Reading = Dealership.Create(
        Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), Now);

    [Fact]
    public void Maps_the_dealership_to_its_summary()
    {
        ScheduleMapper.ToSummary(Reading).ShouldBe(new DealershipSummary(Reading.Id, "Keyloop Motors Reading", "Europe/London"));
    }

    [Fact]
    public void Maps_the_operating_window_with_local_times_in_the_dealership_zone()
    {
        var window = Reading.ResolveOperatingWindow(new DateOnly(2026, 10, 13)).ShouldNotBeNull();

        ScheduleMapper.ToResponse(window, London).ShouldBe(new OperatingWindowResponse(
            new DateTime(2026, 10, 13, 7, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 10, 13, 17, 0, 0, DateTimeKind.Utc),
            "2026-10-13T08:00+01:00",
            "2026-10-13T18:00+01:00"));
    }

    [Fact]
    public void Maps_a_bay_with_its_capabilities_in_declared_order_its_status_and_its_appointments()
    {
        // Given out of order: the domain holds a set, and the board must not depend on hash-set iteration order.
        var bay = ServiceBay.Create(
            Guid.NewGuid(), Reading.Id, "Bay 4 - EV", [BayCapability.WheelAlignment, BayCapability.EvHighVoltage, BayCapability.StandardLift]);
        bay.Deactivate();
        ScheduledAppointmentResponse[] appointments = [Appointment(new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc))];

        var response = ScheduleMapper.ToResponse(bay, appointments);

        (response.Id, response.Name, response.IsActive).ShouldBe((bay.Id, "Bay 4 - EV", false));
        response.Capabilities.ShouldBe([BayCapability.StandardLift, BayCapability.EvHighVoltage, BayCapability.WheelAlignment]);
        response.Appointments.ShouldBe(appointments);
    }

    [Fact]
    public void Maps_a_technician_with_certifications_in_declared_order_and_status()
    {
        var technician = Technician.Create(
            Guid.NewGuid(), Reading.Id, "Ben Okafor", "T-1002", [Certification.HighVoltageElectrical, Certification.GeneralService], isActive: false);

        var response = ScheduleMapper.ToResponse(technician);

        (response.Id, response.Name, response.EmployeeNumber, response.IsActive).ShouldBe((technician.Id, "Ben Okafor", "T-1002", false));
        response.Certifications.ShouldBe([Certification.GeneralService, Certification.HighVoltageElectrical]);
    }

    [Fact]
    public void Maps_the_service_and_technician_summaries()
    {
        var interim = ServiceType.Create(
            Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(90), [BayCapability.StandardLift], [Certification.GeneralService]);
        var technician = Technician.Create(Guid.NewGuid(), Reading.Id, "Amelia Clarke", "T-1001", [Certification.GeneralService]);

        ScheduleMapper.ToSummary(interim).ShouldBe(new ServiceTypeSummary(interim.Id, "INTERIM-SERVICE", "Interim Service", 90));
        ScheduleMapper.ToSummary(technician).ShouldBe(new ResourceSummary(technician.Id, "Amelia Clarke"));
    }

    [Fact]
    public void Maps_an_appointment_with_local_times_whose_offsets_tell_the_repeated_hour_apart()
    {
        // Europe/London leaves BST at 02:00 on 2026-10-25: a job from 00:30Z to 01:30Z starts and ends at 01:30 on the wall clock.
        var start = new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc);
        var serviceType = new ServiceTypeSummary(Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", 60);
        var technician = new ResourceSummary(Guid.NewGuid(), "Amelia Clarke");
        var row = new DayScheduleReader.AppointmentRow(
            Guid.NewGuid(), Guid.NewGuid(), technician.Id, serviceType.Id, TimeSlot.Create(start, start.AddHours(1)), AppointmentStatus.InProgress,
            "WVWZZZ1KZAW123456", "AB12 CDE", "Alex Morgan");

        var response = ScheduleMapper.ToResponse(row, serviceType, technician, London);

        response.ShouldBe(new ScheduledAppointmentResponse(
            row.Id,
            start,
            start.AddHours(1),
            "2026-10-25T01:30+01:00",
            "2026-10-25T01:30+00:00",
            AppointmentStatus.InProgress,
            serviceType,
            technician,
            "WVWZZZ1KZAW123456", // the full VIN: the board is a staff tool, as the booking response is
            "AB12 CDE",
            "Alex Morgan"));
    }

    private static ScheduledAppointmentResponse Appointment(DateTime startUtc) =>
        new(
            Guid.NewGuid(),
            startUtc,
            startUtc.AddHours(1),
            LocalTimeConverter.FormatLocal(startUtc, London),
            LocalTimeConverter.FormatLocal(startUtc.AddHours(1), London),
            AppointmentStatus.Confirmed,
            new ServiceTypeSummary(Guid.NewGuid(), "EV-BATTERY-CHECK", "EV Battery Health Check", 60),
            new ResourceSummary(Guid.NewGuid(), "Ben Okafor"),
            "WVWZZZ1KZAW123456",
            "AB12 CDE",
            "Alex Morgan");
}

using System.Globalization;
using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// <c>GET /api/v1/dealerships/{dealershipId}/schedule?date=</c>: the dispatch board's read model (ARCHITECTURE §5.3, FR-9), a
/// projection over the dealership-day, with the local date strictly <c>yyyy-MM-dd</c>.
/// </summary>
public sealed class ScheduleEndpointTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Schedule_groups_appointments_by_bay_with_technician_and_vehicle()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var early = Book(workshop, TestData.LondonTime(9), workshop.Bay1, workshop.Technician1, customer: 1);
        var late = Book(workshop, TestData.LondonTime(11), workshop.Bay1, workshop.Technician2, customer: 2);
        var onBay2 = Book(workshop, TestData.LondonTime(9, 30), workshop.Bay2, workshop.Technician2, customer: 3);

        // Not on this board: the next day at the same dealership, and the same day at another dealership.
        var nextDay = Book(workshop, TestData.LondonTime(9).AddDays(1), workshop.Bay1, workshop.Technician1, customer: 4);
        var elsewhere = TestData.NewDealership("Elsewhere Motors");
        var elsewhereBay = TestData.NewBay(elsewhere.Id, "Bay 1", BayCapability.StandardLift);
        var elsewhereTechnician = TestData.NewTechnician(elsewhere.Id, "Chloe Martin", "E-0001", Certification.GeneralService);
        var elsewhereAppointment = TestData.NewAppointment(
            elsewhere, workshop.Interim, elsewhereBay, elsewhereTechnician, TestData.LondonTime(9), customer: 5, vin: TestData.VinFor(5));

        // Saved latest first: the board orders by start time, not by insertion.
        await SaveAsync(late, onBay2, early, nextDay, elsewhere, elsewhereBay, elsewhereTechnician, elsewhereAppointment);

        var (schedule, _) = await GetScheduleAsync(workshop.Dealership.Id, TestData.BookingDay);

        schedule.Dealership.ShouldBe(new DealershipSummary(workshop.Dealership.Id, "Test Motors", "Europe/London"));
        schedule.Date.ShouldBe(TestData.BookingDay);
        schedule.SlotGranularityMinutes.ShouldBe(15);
        schedule.OperatingWindow.ShouldBe(new OperatingWindowResponse(
            TestData.LondonTime(8), TestData.LondonTime(18), "2026-10-13T08:00+01:00", "2026-10-13T18:00+01:00"));

        // Lanes by name, each bay's appointments by start.
        schedule.Bays.Select(b => (b.Id, b.Name, b.IsActive)).ShouldBe([(workshop.Bay1.Id, "Bay 1", true), (workshop.Bay2.Id, "Bay 2", true)]);
        schedule.Bays.ShouldAllBe(b => b.Capabilities.SequenceEqual(new[] { BayCapability.StandardLift }));
        schedule.Bays[0].Appointments.Select(a => a.Id).ShouldBe([early.Id, late.Id]);
        schedule.Bays[1].Appointments.Select(a => a.Id).ShouldBe([onBay2.Id]);

        // Each appointment carries its service, its technician (whoever it is, not the lane's), its vehicle and its customer.
        var interim = new ServiceTypeSummary(workshop.Interim.Id, "INTERIM-SERVICE", "INTERIM-SERVICE", 60);
        var amelia = new ResourceSummary(workshop.Technician1.Id, "Amelia Clarke");
        var ben = new ResourceSummary(workshop.Technician2.Id, "Ben Okafor");
        schedule.Bays[0].Appointments[0].ShouldBe(new ScheduledAppointmentResponse(
            early.Id,
            TestData.LondonTime(9),
            TestData.LondonTime(10),
            "2026-10-13T09:00+01:00",
            "2026-10-13T10:00+01:00",
            AppointmentStatus.Confirmed,
            interim,
            amelia,
            TestData.VinFor(1),
            "AB12 CDE",
            "Customer 1"));
        schedule.Bays[0].Appointments[1].ShouldBe(new ScheduledAppointmentResponse(
            late.Id, TestData.LondonTime(11), TestData.LondonTime(12), "2026-10-13T11:00+01:00", "2026-10-13T12:00+01:00", AppointmentStatus.Confirmed,
            interim, ben, TestData.VinFor(2), "AB12 CDE", "Customer 2"));
        schedule.Bays[1].Appointments[0].ShouldBe(new ScheduledAppointmentResponse(
            onBay2.Id, TestData.LondonTime(9, 30), TestData.LondonTime(10, 30), "2026-10-13T09:30+01:00", "2026-10-13T10:30+01:00", AppointmentStatus.Confirmed,
            interim, ben, TestData.VinFor(3), "AB12 CDE", "Customer 3"));

        // The roster, by name, for the technician lanes; every appointment's technician is on it.
        schedule.Technicians.Select(t => (t.Id, t.Name, t.EmployeeNumber, t.IsActive))
            .ShouldBe([(workshop.Technician1.Id, "Amelia Clarke", "T-1001", true), (workshop.Technician2.Id, "Ben Okafor", "T-1002", true)]);
        schedule.Technicians.ShouldAllBe(t => t.Certifications.SequenceEqual(new[] { Certification.GeneralService }));
    }

    [Fact]
    public async Task Schedule_excludes_cancelled_but_includes_completed()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        Appointment At(int hour, int customer) => Book(workshop, TestData.LondonTime(hour), workshop.Bay1, workshop.Technician1, customer);

        var noShow = At(8, customer: 1);
        noShow.MarkNoShow(TestData.LondonTime(9)); // allowed once the slot has ended
        var completed = At(9, customer: 2);
        completed.CheckIn(TestData.Now);
        completed.Start(TestData.Now);
        completed.Complete(TestData.Now);
        var inProgress = At(10, customer: 3);
        inProgress.CheckIn(TestData.Now);
        inProgress.Start(TestData.Now);
        var checkedIn = At(11, customer: 4);
        checkedIn.CheckIn(TestData.Now);
        var confirmed = At(12, customer: 5);
        var cancelled = At(13, customer: 6);
        cancelled.Cancel("Customer rang to cancel.", TestData.Now);

        // A cancelled job and the one booked into its slot afterwards: the board shows the new one only.
        var cancelledThenRebooked = At(14, customer: 7);
        cancelledThenRebooked.Cancel("Customer rescheduled.", TestData.Now);
        var rebooked = At(14, customer: 8);
        await SaveAsync(noShow, completed, inProgress, checkedIn, confirmed, cancelled, cancelledThenRebooked, rebooked);

        var (schedule, _) = await GetScheduleAsync(workshop.Dealership.Id, TestData.BookingDay);

        var bay1 = schedule.Bays.Single(b => b.Id == workshop.Bay1.Id);
        bay1.Appointments.Select(a => (a.Id, a.Status)).ShouldBe(
        [
            (noShow.Id, AppointmentStatus.NoShow),
            (completed.Id, AppointmentStatus.Completed),
            (inProgress.Id, AppointmentStatus.InProgress),
            (checkedIn.Id, AppointmentStatus.CheckedIn),
            (confirmed.Id, AppointmentStatus.Confirmed),
            (rebooked.Id, AppointmentStatus.Confirmed),
        ]);
        schedule.Bays.SelectMany(b => b.Appointments).ShouldNotContain(a => a.Status == AppointmentStatus.Cancelled);
    }

    [Fact]
    public async Task Schedule_closed_day_has_null_window()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var sunday = new DateOnly(2026, 10, 18);

        var (schedule, json) = await GetScheduleAsync(workshop.Dealership.Id, sunday);

        schedule.Date.ShouldBe(sunday);
        schedule.OperatingWindow.ShouldBeNull();
        schedule.Dealership.Id.ShouldBe(workshop.Dealership.Id);

        // The board keeps its lanes on a closed day: every bay, with no appointments, and every technician.
        schedule.Bays.Select(b => (b.Name, b.Appointments.Count)).ShouldBe([("Bay 1", 0), ("Bay 2", 0)]);
        schedule.Technicians.Select(t => t.Name).ShouldBe(["Amelia Clarke", "Ben Okafor"]);
        using var body = JsonDocument.Parse(json);
        body.RootElement.GetProperty("date").GetString().ShouldBe("2026-10-18");
        body.RootElement.GetProperty("operatingWindow").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Schedule_lists_inactive_bays_and_technicians_marked_and_keeps_the_appointments_they_hold()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var booked = Book(workshop, TestData.LondonTime(10), workshop.Bay2, workshop.Technician1, customer: 1);
        var dormant = Technician.Create(Guid.NewGuid(), workshop.Dealership.Id, "Dana Whitfield", "T-1004", [Certification.GeneralService], isActive: false);
        await SaveAsync(booked, dormant);

        // Bay 2 goes out of service after the booking was made: it takes no new work, but its booked job is still real.
        await _factory.WithDbAsync(async db =>
        {
            var bay = await db.ServiceBays.SingleAsync(b => b.Id == workshop.Bay2.Id, Ct);
            bay.Deactivate();
            await db.SaveChangesAsync(Ct);
        });

        var (schedule, _) = await GetScheduleAsync(workshop.Dealership.Id, TestData.BookingDay);

        schedule.Bays.Select(b => (b.Name, b.IsActive)).ShouldBe([("Bay 1", true), ("Bay 2", false)]);
        schedule.Bays[1].Appointments.Select(a => a.Id).ShouldBe([booked.Id]);
        schedule.Technicians.Select(t => (t.Name, t.IsActive)).ShouldBe([("Amelia Clarke", true), ("Ben Okafor", true), ("Dana Whitfield", false)]);
    }

    [Fact]
    public async Task Schedule_local_times_carry_the_dealership_offset_on_the_wire()
    {
        var dealership = TestData.NewDealership("Autohaus Test", "Europe/Berlin", OperatingHours.MondayToFriday(new TimeOnly(7, 30), new TimeOnly(18, 30)));
        var bay = TestData.NewBay(dealership.Id, "Halle 1", BayCapability.Diagnostics, BayCapability.StandardLift);
        var technician = TestData.NewTechnician(dealership.Id, "Greta Vogel", "M-2001", Certification.Diagnostics, Certification.GeneralService);
        var interim = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        var appointment = TestData.NewAppointment(
            dealership, interim, bay, technician, new DateTime(2026, 10, 13, 6, 0, 0, DateTimeKind.Utc), customer: 7, vin: TestData.VinFor(7));
        await SaveAsync(dealership, bay, technician, interim, appointment);

        var (_, json) = await GetScheduleAsync(dealership.Id, TestData.BookingDay);

        // The wire format: instants in UTC with Z, local times with the zone's offset that day (CEST, UTC+2), enums as names in their
        // declared order, ids as lowercase GUIDs, and every member present.
        using var body = JsonDocument.Parse(json);
        var root = body.RootElement;
        root.EnumerateObject().Select(p => p.Name).ShouldBe(["dealership", "date", "operatingWindow", "slotGranularityMinutes", "bays", "technicians"]);
        root.GetProperty("dealership").GetRawText().ShouldBe($$"""{"id":"{{dealership.Id}}","name":"Autohaus Test","timeZoneId":"Europe/Berlin"}""");
        root.GetProperty("operatingWindow").GetRawText().ShouldBe(
            """{"startUtc":"2026-10-13T05:30:00Z","endUtc":"2026-10-13T16:30:00Z","opensAtLocal":"2026-10-13T07:30+02:00","closesAtLocal":"2026-10-13T18:30+02:00"}""");
        var lane = root.GetProperty("bays").EnumerateArray().ShouldHaveSingleItem();
        lane.EnumerateObject().Select(p => p.Name).ShouldBe(["id", "name", "capabilities", "isActive", "appointments"]);
        lane.GetProperty("capabilities").GetRawText().ShouldBe("""["StandardLift","Diagnostics"]""");
        lane.GetProperty("appointments").EnumerateArray().ShouldHaveSingleItem().GetRawText().ShouldBe(
            $$"""{"id":"{{appointment.Id}}","startUtc":"2026-10-13T06:00:00Z","endUtc":"2026-10-13T07:00:00Z","startLocal":"2026-10-13T08:00+02:00","endLocal":"2026-10-13T09:00+02:00","status":"Confirmed","serviceType":{"id":"{{interim.Id}}","code":"INTERIM-SERVICE","name":"INTERIM-SERVICE","durationMinutes":60},"technician":{"id":"{{technician.Id}}","name":"Greta Vogel"},"vin":"WVWZZZ1KZAW000007","registration":"AB12 CDE","customerName":"Customer 7"}""");
        root.GetProperty("technicians").EnumerateArray().ShouldHaveSingleItem().GetRawText().ShouldBe(
            $$"""{"id":"{{technician.Id}}","name":"Greta Vogel","employeeNumber":"M-2001","certifications":["GeneralService","Diagnostics"],"isActive":true}""");
    }

    [Theory]
    [InlineData("Europe/London", "2025-06-03")] // a past day: the board's history stays readable
    [InlineData("Asia/Tokyo", "0001-01-01")] // the opening falls before the first instant .NET can hold; TimeZoneInfo clamps it
    [InlineData("America/Los_Angeles", "9999-12-31")] // the closing falls after the last one
    public async Task Schedule_reads_any_well_formed_date_unlike_availability(string timeZoneId, string date)
    {
        var dealership = TestData.NewDealership("Anywhen Motors", timeZoneId);
        await SaveAsync(dealership, TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift));

        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealership.Id}/schedule?date={date}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var schedule = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.WorkshopScheduleResponse, Ct);
        schedule.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture).ShouldBe(date);
        schedule.OperatingWindow.ShouldNotBeNull("each date is a weekday the dealership opens");
        schedule.Bays.ShouldHaveSingleItem().Appointments.ShouldBeEmpty();
    }

    [Theory]
    [InlineData("date=13%2F10%2F2026")] // day-first
    [InlineData("date=10%2F13%2F2026")] // month-first, which DateOnly binding would silently accept
    [InlineData("date=2026-10-13T00%3A00")]
    [InlineData("date=2026-02-30")]
    [InlineData("date=")]
    [InlineData("")] // missing
    public async Task Schedule_invalid_date_400(string dateQuery)
    {
        var dealership = TestData.NewDealership();
        await SaveAsync(dealership);

        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealership.Id}/schedule?{dateQuery}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/validation-error");
        root.GetProperty("status").GetInt32().ShouldBe(400);
        root.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        var errors = root.GetProperty("errors");
        errors.EnumerateObject().Select(e => e.Name).ShouldBe(["date"]);
        errors.GetProperty("date").GetArrayLength().ShouldBe(1); // the first rule that fails, not a cascade
    }

    [Fact]
    public async Task Schedule_unknown_dealership_404()
    {
        var unknown = Guid.Parse("0199d2a4-0000-7000-8000-00000000dead");

        using var response = await _client.GetAsync($"/api/v1/dealerships/{unknown}/schedule?date=2026-10-13", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/not-found");
        root.GetProperty("resource").GetString().ShouldBe("dealership");
        root.GetProperty("id").GetGuid().ShouldBe(unknown);
        root.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{unknown}/schedule");
    }

    /// <summary>A confirmed appointment at the workshop with a VIN and customer of its own (<paramref name="customer"/>), so each is traceable on the board.</summary>
    private static Appointment Book(TestData.Workshop workshop, DateTime startUtc, ServiceBay bay, Technician technician, int customer) =>
        TestData.NewAppointment(workshop.Dealership, workshop.Interim, bay, technician, startUtc, customer, TestData.VinFor(customer));

    private async Task<(WorkshopScheduleResponse Schedule, string Json)> GetScheduleAsync(Guid dealershipId, DateOnly date)
    {
        var url = string.Create(CultureInfo.InvariantCulture, $"/api/v1/dealerships/{dealershipId}/schedule?date={date:yyyy-MM-dd}");
        using var response = await _client.GetAsync(url, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var json = await response.Content.ReadAsStringAsync(Ct);
        return (await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.WorkshopScheduleResponse, Ct), json);
    }

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });
}

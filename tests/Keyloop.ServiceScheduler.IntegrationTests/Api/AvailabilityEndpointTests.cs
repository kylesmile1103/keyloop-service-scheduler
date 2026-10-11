using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Globalization;
using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// <c>GET /api/v1/dealerships/{dealershipId}/availability?serviceTypeId=&amp;date=</c>: the domain calculator over one indexed read of
/// the dealership-day, with the local date strictly <c>yyyy-MM-dd</c>.
/// </summary>
public sealed class AvailabilityEndpointTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly TimeSpan Grid = TimeSpan.FromMinutes(15);

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
    public async Task Availability_on_closed_day_returns_empty_with_reason()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var sunday = new DateOnly(2026, 10, 18);

        var (availability, json) = await GetAvailabilityAsync(workshop.Dealership.Id, workshop.Interim.Id, sunday);

        availability.Date.ShouldBe(sunday);
        availability.OperatingWindow.ShouldBeNull();
        availability.Slots.ShouldBeEmpty();
        availability.UnavailableReason.ShouldBe("closed");
        json.ShouldBe(
            """{"date":"2026-10-18","timeZoneId":"Europe/London","operatingWindow":null,"durationMinutes":60,"slotGranularityMinutes":15,"slots":[],"unavailableReason":"closed"}""");
    }

    [Fact]
    public async Task Availability_matches_domain_calculator_for_seeded_day()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        Appointment[] active =
        [
            workshop.Book(TestData.LondonTime(9), workshop.Bay1, workshop.Technician1, customer: 1),
            workshop.Book(TestData.LondonTime(9, 30), workshop.Bay2, workshop.Technician2, customer: 2),
            workshop.Book(TestData.LondonTime(11), workshop.Bay1, workshop.Technician2, customer: 3),
        ];
        var cancelled = workshop.Book(TestData.LondonTime(14), workshop.Bay1, workshop.Technician1, customer: 4);
        cancelled.Cancel("Customer rang to cancel.", TestData.Now);
        await SaveAsync([.. active, cancelled]);

        var window = workshop.Dealership.ResolveOperatingWindow(TestData.BookingDay).ShouldNotBeNull();
        var expected = AvailabilityCalculator.Compute(
            window,
            workshop.Interim.Duration,
            15,
            [Busy(workshop.Bay1.Id, active.Where(a => a.BayId == workshop.Bay1.Id)), Busy(workshop.Bay2.Id, active.Where(a => a.BayId == workshop.Bay2.Id))],
            [
                Busy(workshop.Technician1.Id, active.Where(a => a.TechnicianId == workshop.Technician1.Id)),
                Busy(workshop.Technician2.Id, active.Where(a => a.TechnicianId == workshop.Technician2.Id)),
            ]);

        var (availability, _) = await GetAvailabilityAsync(workshop.Dealership.Id, workshop.Interim.Id, TestData.BookingDay);

        availability.UnavailableReason.ShouldBeNull();
        availability.DurationMinutes.ShouldBe(60);
        availability.SlotGranularityMinutes.ShouldBe(15);
        var operatingWindow = availability.OperatingWindow.ShouldNotBeNull();
        (operatingWindow.StartUtc, operatingWindow.EndUtc).ShouldBe((window.StartUtc, window.EndUtc));
        availability.Slots.Select(s => (s.StartUtc, s.EndUtc, s.FreeBays, s.FreeTechnicians))
            .ShouldBe(expected.Select(s => (s.StartUtc, s.EndUtc, s.FreeBays, s.FreeTechnicians)));

        // The appointments shaped the answer: 09:00 collides on both bays, and the cancelled 14:00 job holds nothing.
        availability.Slots.Select(s => s.StartUtc).ShouldNotContain(TestData.LondonTime(9));
        availability.Slots.ShouldContain(s => s.StartUtc == TestData.LondonTime(14) && s.FreeBays == 2 && s.FreeTechnicians == 2);
    }

    [Fact]
    public async Task Availability_reports_no_qualified_resources()
    {
        // The technician is certified; the dealership has no EV bay, so the service can never be booked here.
        var dealership = TestData.NewDealership("Standard Motors");
        var ev = TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Ben Okafor", "T-1002", Certification.GeneralService, Certification.HighVoltageElectrical),
            ev);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, ev.Id, TestData.BookingDay);

        availability.UnavailableReason.ShouldBe("no-qualified-resources");
        availability.Slots.ShouldBeEmpty();
        availability.OperatingWindow.ShouldNotBeNull("the dealership is open; it is the resources that are missing");
    }

    [Fact]
    public async Task Availability_reports_no_qualified_resources_when_no_technician_is_certified()
    {
        // The technician-side half: an active EV bay qualifies, but the only technician lacks the high-voltage certification (and
        // a certified colleague is inactive), so the service can never be booked here either.
        var dealership = TestData.NewDealership("Uncertified Motors");
        var ev = TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "EV Bay", BayCapability.EvHighVoltage, BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            Technician.Create(Guid.NewGuid(), dealership.Id, "Ben Okafor", "T-1002", [Certification.HighVoltageElectrical], isActive: false),
            ev);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, ev.Id, TestData.BookingDay);

        availability.UnavailableReason.ShouldBe("no-qualified-resources");
        availability.Slots.ShouldBeEmpty();
        availability.OperatingWindow.ShouldNotBeNull();
    }

    [Fact]
    public async Task Availability_for_a_service_longer_than_the_opening_hours_is_empty_without_a_reason()
    {
        // Open 08:00–10:00 on the booking day; a three-hour service fits no start, yet the day is open and the resources qualify.
        var dealership = TestData.NewDealership("Short Day Motors", hours: OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(10, 0)));
        var major = TestData.NewServiceType("MAJOR-SERVICE", 180, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            major);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, major.Id, TestData.BookingDay);

        availability.OperatingWindow.ShouldNotBeNull();
        availability.Slots.ShouldBeEmpty();
        availability.UnavailableReason.ShouldBeNull();
    }

    [Fact]
    public async Task Availability_ignores_inactive_and_unqualified_resources()
    {
        // One active qualified bay and technician; an inactive copy of each, and an active MOT-only pair, must add no capacity.
        var dealership = TestData.NewDealership("Dormant Bay Motors");
        var interim = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            ServiceBay.Create(Guid.NewGuid(), dealership.Id, "Bay 2 — Dormant", [BayCapability.StandardLift], isActive: false),
            TestData.NewBay(dealership.Id, "Bay 3 — MOT", BayCapability.MotTesting),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            Technician.Create(Guid.NewGuid(), dealership.Id, "Ben Okafor", "T-1002", [Certification.GeneralService], isActive: false),
            TestData.NewTechnician(dealership.Id, "Farid Haddad", "T-1006", Certification.MotTester),
            interim);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, interim.Id, TestData.BookingDay);

        availability.Slots.Count.ShouldBe(37); // 08:00 to 17:00 on the 15-minute grid
        availability.Slots.ShouldAllBe(s => s.FreeBays == 1 && s.FreeTechnicians == 1);
    }

    [Fact]
    public async Task Availability_leaves_the_slot_adjacent_to_a_back_to_back_booking_available()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        await SaveAsync(
            workshop.Book(TestData.LondonTime(10), workshop.Bay1, workshop.Technician1, customer: 1),
            workshop.Book(TestData.LondonTime(10), workshop.Bay2, workshop.Technician2, customer: 2));

        var (availability, _) = await GetAvailabilityAsync(workshop.Dealership.Id, workshop.Interim.Id, TestData.BookingDay);

        // Half-open slots: 09:00–10:00 ends as the bookings start and 11:00–12:00 starts as they end; nothing in between fits.
        var starts = availability.Slots.Select(s => s.StartUtc).ToList();
        starts.ShouldContain(TestData.LondonTime(9));
        starts.ShouldContain(TestData.LondonTime(11));
        starts.Where(s => s > TestData.LondonTime(9) && s < TestData.LondonTime(11)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Availability_slot_local_strings_use_dealership_zone()
    {
        var dealership = TestData.NewDealership("Autohaus Test", "Europe/Berlin", OperatingHours.MondayToFriday(new TimeOnly(7, 30), new TimeOnly(18, 30)));
        var interim = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Halle 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Greta Vogel", "M-2001", Certification.GeneralService),
            interim);

        var (availability, json) = await GetAvailabilityAsync(dealership.Id, interim.Id, TestData.BookingDay);

        availability.TimeZoneId.ShouldBe("Europe/Berlin");
        availability.OperatingWindow.ShouldBe(new OperatingWindowResponse(
            new DateTime(2026, 10, 13, 5, 30, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 16, 30, 0, DateTimeKind.Utc), "2026-10-13T07:30+02:00", "2026-10-13T18:30+02:00"));
        availability.Slots[0].StartLocal.ShouldBe("2026-10-13T07:30+02:00"); // 05:30Z in CEST (UTC+2)
        availability.Slots[^1].StartLocal.ShouldBe("2026-10-13T17:30+02:00");

        // The wire format of one slot: instants in UTC with Z, the local start as ISO-8601 with the zone's offset that day.
        using var body = JsonDocument.Parse(json);
        body.RootElement.GetProperty("slots")[0].GetRawText().ShouldBe(
            """{"startUtc":"2026-10-13T05:30:00Z","endUtc":"2026-10-13T06:30:00Z","startLocal":"2026-10-13T07:30+02:00","freeBays":1,"freeTechnicians":1}""");
    }

    [Fact]
    public async Task Availability_on_fall_back_day_returns_unique_ascending_grid_aligned_starts()
    {
        // Europe/London leaves BST at 02:00 on 2026-10-25, so 01:00–02:00 local happens twice. Open 01:00–04:00 that Sunday: the
        // ambiguous opening resolves to the earlier instant (01:00 BST = 00:00Z), so the window is four hours long in absolute time.
        var sunday = new DateOnly(2026, 10, 25);
        var hours = OperatingHours.Create(Enum.GetValues<DayOfWeek>().Select(day => day == DayOfWeek.Sunday
            ? new DayOperatingHours(day, new TimeOnly(1, 0), new TimeOnly(4, 0))
            : new DayOperatingHours(day, null, null)));
        var dealership = TestData.NewDealership("Night Shift Motors", "Europe/London", hours);
        var interim = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            interim);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, interim.Id, sunday);

        var opens = new DateTime(2026, 10, 25, 0, 0, 0, DateTimeKind.Utc);
        availability.OperatingWindow.ShouldBe(new OperatingWindowResponse(opens, opens.AddHours(4), "2026-10-25T01:00+01:00", "2026-10-25T04:00+00:00"));
        var starts = availability.Slots.Select(s => s.StartUtc).ToList();
        starts.ShouldBe([.. Enumerable.Range(0, 13).Select(k => opens + (k * Grid))]); // 00:00Z to 03:00Z: none duplicated, none skipped
        starts.ShouldBeUnique();
        starts.ShouldAllBe(s => (s - opens).Ticks % Grid.Ticks == 0);

        // The repeated hour shows the same wall-clock time twice; the offset tells the two apart (startUtc stays the identity of a slot).
        availability.Slots.Where(s => s.StartLocal.StartsWith("2026-10-25T01:00", StringComparison.Ordinal)).Select(s => (s.StartUtc, s.StartLocal))
            .ShouldBe([(opens, "2026-10-25T01:00+01:00"), (opens.AddHours(1), "2026-10-25T01:00+00:00")]);
        availability.Slots.Select(s => s.StartLocal).ShouldBeUnique();
    }

    [Fact]
    public async Task Availability_on_a_window_lost_to_spring_forward_is_empty_without_a_reason()
    {
        // Europe/London skips 01:00–02:00 on 2027-03-28. Open 01:15–01:45 that Sunday: both ends advance to 02:00 BST (01:00Z), so
        // the dealership is open for no time at all. That is not "closed" (it has hours that day) and not a resource gap.
        _factory.Clock.SetUtcNow(new DateTimeOffset(2027, 3, 20, 8, 0, 0, TimeSpan.Zero));
        var hours = OperatingHours.Create(Enum.GetValues<DayOfWeek>().Select(day => day == DayOfWeek.Sunday
            ? new DayOperatingHours(day, new TimeOnly(1, 15), new TimeOnly(1, 45))
            : new DayOperatingHours(day, null, null)));
        var dealership = TestData.NewDealership("Gap Motors", "Europe/London", hours);
        var interim = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            interim);

        var (availability, _) = await GetAvailabilityAsync(dealership.Id, interim.Id, new DateOnly(2027, 3, 28));

        var instant = new DateTime(2027, 3, 28, 1, 0, 0, DateTimeKind.Utc);
        availability.OperatingWindow.ShouldBe(new OperatingWindowResponse(instant, instant, "2027-03-28T02:00+01:00", "2027-03-28T02:00+01:00"));
        availability.Slots.ShouldBeEmpty();
        availability.UnavailableReason.ShouldBeNull();
    }

    [Theory]
    [InlineData("serviceTypeId=00000000-0000-0000-0000-000000000000&date=2026-10-13", "serviceTypeId must not be the empty id.")]
    [InlineData("date=2026-10-13", "serviceTypeId is required and must be a GUID.")] // missing
    // Not a GUID: the generated binder leaves the nullable parameter null and, because the endpoint has a filter, still runs it.
    [InlineData("serviceTypeId=not-a-guid&date=2026-10-13", "serviceTypeId is required and must be a GUID.")]
    public async Task Availability_invalid_service_type_id_400(string queryString, string message)
    {
        var dealership = TestData.NewDealership();
        await SaveAsync(dealership);

        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealership.Id}/availability?{queryString}", Ct);

        using var problem = await ShouldBeValidationErrorAsync(response, ["serviceTypeId"]);
        problem.RootElement.GetProperty("errors").GetProperty("serviceTypeId").EnumerateArray().Select(m => m.GetString()).ShouldBe([message]);
    }

    [Theory]
    [InlineData("date=13%2F10%2F2026")] // day-first
    [InlineData("date=10%2F13%2F2026")] // month-first, which DateOnly binding would silently accept
    [InlineData("date=2026-10-13T00%3A00")]
    [InlineData("date=2026-02-30")]
    [InlineData("date=")]
    [InlineData("")] // missing
    public async Task Availability_rejects_a_date_that_is_not_yyyy_MM_dd_400(string dateQuery)
    {
        var dealership = TestData.NewDealership();
        await SaveAsync(dealership);

        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealership.Id}/availability?serviceTypeId={Guid.NewGuid()}&{dateQuery}", Ct);

        using var problem = await ShouldBeValidationErrorAsync(response, ["date"]);
        problem.RootElement.GetProperty("errors").GetProperty("date").GetArrayLength().ShouldBe(1); // the first rule that fails, not a cascade
    }

    [Fact]
    public async Task Availability_unknown_dealership_404()
    {
        var unknown = Guid.Parse("0199d2a4-0000-7000-8000-00000000dead");

        using var response = await _client.GetAsync($"/api/v1/dealerships/{unknown}/availability?serviceTypeId={Guid.NewGuid()}&date=2026-10-13", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/not-found");
        root.GetProperty("resource").GetString().ShouldBe("dealership");
        root.GetProperty("id").GetGuid().ShouldBe(unknown);
        root.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{unknown}/availability");
    }

    [Fact]
    public async Task Availability_unknown_service_type_404()
    {
        var dealership = TestData.NewDealership();
        await SaveAsync(dealership);
        var unknown = Guid.Parse("0199d2a4-0000-7000-8000-00000000beef");

        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealership.Id}/availability?serviceTypeId={unknown}&date=2026-10-13", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var problem = await response.ReadProblemAsync(Ct);
        problem.RootElement.GetProperty("resource").GetString().ShouldBe("service-type");
        problem.RootElement.GetProperty("id").GetGuid().ShouldBe(unknown);
    }

    [Fact]
    public async Task Availability_records_the_compute_span_and_read_path_metrics()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        await SaveAsync(workshop.Book(TestData.LondonTime(9)));
        var dealershipId = workshop.Dealership.Id.ToString();

        var spans = new ConcurrentQueue<Activity>();
        using var activities = new ActivityListener
        {
            ShouldListenTo = source => source.Name == SchedulerTelemetry.Name,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = spans.Enqueue,
        };
        ActivitySource.AddActivityListener(activities);
        var durations = new ConcurrentQueue<(double Value, string? DealershipId)>();
        var slotCounts = new ConcurrentQueue<long>();
        using var meters = new MeterListener
        {
            InstrumentPublished = (instrument, listener) =>
            {
                if (instrument.Meter.Name == SchedulerTelemetry.Name && instrument.Name.StartsWith("scheduler.availability.", StringComparison.Ordinal))
                {
                    listener.EnableMeasurementEvents(instrument);
                }
            },
        };
        meters.SetMeasurementEventCallback<double>((_, value, tags, _) =>
            durations.Enqueue((value, tags.ToArray().SingleOrDefault(t => t.Key == "dealership.id").Value as string)));
        meters.SetMeasurementEventCallback<long>((_, value, _, _) => slotCounts.Enqueue(value));
        meters.Start();

        var (availability, _) = await GetAvailabilityAsync(workshop.Dealership.Id, workshop.Interim.Id, TestData.BookingDay);

        var span = spans.ShouldHaveSingleItem();
        span.OperationName.ShouldBe("scheduler.compute_availability");
        span.GetTagItem("availability.candidates_bays").ShouldBe(2);
        span.GetTagItem("availability.candidates_technicians").ShouldBe(2);
        span.GetTagItem("availability.slots_returned").ShouldBe(availability.Slots.Count);
        var duration = durations.ShouldHaveSingleItem();
        duration.DealershipId.ShouldBe(dealershipId);
        duration.Value.ShouldBeGreaterThan(0, "a latency is real elapsed time, not the injected (here frozen) business clock");
        slotCounts.ShouldBe([availability.Slots.Count]);
    }

    private static ResourceBusy Busy(Guid resourceId, IEnumerable<Appointment> appointments) => new(resourceId, [.. appointments.Select(a => a.Slot)]);

    /// <summary>Asserts a 400 <c>validation-error</c> whose <c>errors</c> has exactly <paramref name="errorKeys"/>; the caller disposes the problem.</summary>
    private static async Task<JsonDocument> ShouldBeValidationErrorAsync(HttpResponseMessage response, string[] errorKeys)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/validation-error");
        root.GetProperty("status").GetInt32().ShouldBe(400);
        root.GetProperty("errors").EnumerateObject().Select(e => e.Name).ShouldBe(errorKeys);
        root.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        return problem;
    }

    private async Task<(AvailabilityResponse Availability, string Json)> GetAvailabilityAsync(Guid dealershipId, Guid serviceTypeId, DateOnly date)
    {
        var url = string.Create(CultureInfo.InvariantCulture, $"/api/v1/dealerships/{dealershipId}/availability?serviceTypeId={serviceTypeId}&date={date:yyyy-MM-dd}");
        using var response = await _client.GetAsync(url, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var json = await response.Content.ReadAsStringAsync(Ct);
        return (await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AvailabilityResponse, Ct), json);
    }

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });
}

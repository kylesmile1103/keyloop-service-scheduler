using System.Net;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// <c>POST /api/v1/dealerships/{dealershipId}/appointments</c>: rule checks, allocation (SYSTEM_DESIGN §6.3), the locked pre-check and
/// the exclusion-constraint backstop (§7.3–§7.4), suggestions, telemetry and rate limiting. The workshop is Test Motors (Europe/London,
/// Monday–Saturday 08:00–18:00, so 07:00Z–17:00Z on the booking day) with two standard bays, two general technicians and a 60-minute
/// interim service; the clock is Monday 2026-10-12 08:00Z and SystemTest has no lead time.
/// </summary>
public sealed class BookAppointmentTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc); // 11:00 BST

    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;
    private TestData.Workshop _workshop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Books_and_returns_201_with_location_and_allocation()
    {
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten, notes: "  Rattle from the front left wheel.  ");

        using var response = await PostAsync(_workshop.Dealership.Id, request);

        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        response.Headers.Location.ShouldNotBeNull().OriginalString.ShouldBe($"/api/v1/appointments/{appointment.Id}");
        response.Headers.Contains("Idempotent-Replayed").ShouldBeFalse();

        appointment.Status.ShouldBe(AppointmentStatus.Confirmed);
        appointment.DealershipId.ShouldBe(_workshop.Dealership.Id);
        appointment.ServiceType.ShouldBe(new ServiceTypeSummary(_workshop.Interim.Id, "INTERIM-SERVICE", "INTERIM-SERVICE", 60));
        appointment.Bay.ShouldBe(new ResourceSummary(_workshop.Bay1.Id, "Bay 1")); // equal surplus and load: by name
        appointment.Technician.ShouldBe(new ResourceSummary(_workshop.Technician1.Id, "Amelia Clarke"));
        (appointment.StartUtc, appointment.EndUtc).ShouldBe((Ten, Ten.AddHours(1)));
        (appointment.StartLocal, appointment.EndLocal).ShouldBe(("2026-10-13T11:00+01:00", "2026-10-13T12:00+01:00"));
        appointment.Customer.ShouldBe(new CustomerResponse("Customer 1", "customer1@example.com", "+44 7700 900001"));
        appointment.Vehicle.ShouldBe(new VehicleResponse(TestData.VinFor(1), "AB12 CDE", "Volkswagen", "Golf"));
        appointment.Notes.ShouldBe("Rattle from the front left wheel."); // trimmed by the aggregate
        appointment.CancellationReason.ShouldBeNull();
        (appointment.CreatedAtUtc, appointment.UpdatedAtUtc).ShouldBe((TestData.Now, TestData.Now));

        await _factory.WithDbAsync(async db =>
        {
            var row = await db.Appointments.AsNoTracking().SingleAsync(Ct);
            row.Id.ShouldBe(appointment.Id);
            (row.BayId, row.TechnicianId, row.Slot).ShouldBe((_workshop.Bay1.Id, _workshop.Technician1.Id, TimeSlot.Create(Ten, Ten.AddHours(1))));
            var history = await db.AppointmentHistory.AsNoTracking().SingleAsync(Ct);
            (history.AppointmentId, history.EventType).ShouldBe((appointment.Id, "Booked"));
            history.Payload.ShouldContain(Vin.Create(TestData.VinFor(1)).Masked);
            history.Payload.ShouldNotContain(TestData.VinFor(1));
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0, "no Idempotency-Key, nothing memoised");
        });
    }

    [Fact]
    public async Task Honours_preferred_bay_when_free()
    {
        var appointment = await BookAsync(TestData.BookingRequest(
            _workshop.Interim.Id, Ten, preferredBayId: _workshop.Bay2.Id, preferredTechnicianId: _workshop.Technician2.Id));

        appointment.Bay.Id.ShouldBe(_workshop.Bay2.Id);
        appointment.Technician.Id.ShouldBe(_workshop.Technician2.Id);
    }

    [Fact]
    public async Task Ignores_preferred_bay_when_busy()
    {
        var first = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1));
        first.Bay.Id.ShouldBe(_workshop.Bay1.Id);

        var second = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2, preferredBayId: _workshop.Bay1.Id));

        second.Bay.Id.ShouldBe(_workshop.Bay2.Id, "the hint names a busy bay, so it is ignored rather than failing the booking");
        second.Technician.Id.ShouldBe(_workshop.Technician2.Id);
    }

    [Fact]
    public async Task Ignores_a_preferred_bay_that_cannot_host_the_service()
    {
        var motBay = TestData.NewBay(_workshop.Dealership.Id, "Bay 0 - MOT", BayCapability.MotTesting);
        await SaveAsync(motBay);

        var appointment = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, preferredBayId: motBay.Id));

        appointment.Bay.Id.ShouldBe(_workshop.Bay1.Id);
    }

    [Fact]
    public async Task Prefers_bay_with_fewest_surplus_capabilities()
    {
        // The EV bay sorts first by name and can host a standard service too, but taking it would waste specialised capacity.
        var evBay = TestData.NewBay(_workshop.Dealership.Id, "Bay 0 - EV", BayCapability.StandardLift, BayCapability.EvHighVoltage);
        await SaveAsync(evBay);

        var appointment = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));

        appointment.Bay.Id.ShouldBe(_workshop.Bay1.Id);
    }

    [Fact]
    public async Task Balances_load_between_otherwise_equal_technicians()
    {
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1)); // Bay 1 + Amelia

        var later = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten.AddHours(2), customerIndex: 2));

        later.Bay.Id.ShouldBe(_workshop.Bay2.Id, "Bay 1 already has a booking today");
        later.Technician.Id.ShouldBe(_workshop.Technician2.Id, "Amelia already has a booking today");
    }

    [Theory]
    [InlineData("2026-10-13T17:30:00Z")] // starts after closing (18:30 BST)
    [InlineData("2026-10-13T16:01:00Z")] // ends one minute after closing
    [InlineData("2026-10-13T06:45:00Z")] // starts before opening
    public async Task Rejects_outside_operating_hours_422(string start)
    {
        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc(start)));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "outside-operating-hours", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Outside operating hours");
        problem.GetProperty("operatingWindow").GetRawText().ShouldBe("""{"startUtc":"2026-10-13T07:00:00Z","endUtc":"2026-10-13T17:00:00Z"}""");
        problem.GetProperty("detail").GetString().ShouldNotBeNull().ShouldContain("(2026-10-13T08:00+01:00 to 2026-10-13T18:00+01:00, Europe/London)");
        await ShouldHaveNoAppointmentsAsync();
    }

    [Fact]
    public async Task Accepts_slot_ending_exactly_at_close()
    {
        var appointment = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Utc("2026-10-13T16:00:00Z")));

        appointment.EndUtc.ShouldBe(Utc("2026-10-13T17:00:00Z")); // 18:00 BST: closing time, half-open
        appointment.EndLocal.ShouldBe("2026-10-13T18:00+01:00");
    }

    [Fact]
    public async Task Rejects_closed_day_422()
    {
        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc("2026-10-18T10:00:00Z")));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "outside-operating-hours", Ct);
        problem.GetProperty("localDate").GetString().ShouldBe("2026-10-18");
        problem.GetProperty("detail").GetString().ShouldBe("Test Motors is closed on Sundays (no opening hours on 2026-10-18).");
    }

    [Fact]
    public async Task Rejects_lead_time_422()
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder.UseSetting("Scheduling:MinimumLeadTime", "01:00:00"));
        using var client = factory.CreateClient();

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, TestData.Now.AddMinutes(30)), client: client);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "lead-time-not-met", Ct);
        problem.GetProperty("earliestStartUtc").GetString().ShouldBe("2026-10-12T09:00:00Z");
    }

    [Fact]
    public async Task Rejects_beyond_horizon_422()
    {
        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc("2027-01-11T10:00:00Z")));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "beyond-booking-horizon", Ct);
        problem.GetProperty("latestStartUtc").GetString().ShouldBe("2027-01-10T08:00:00Z");
    }

    [Theory]
    [InlineData("9999-12-31T23:30:00Z", 60)]
    [InlineData("9999-12-31T23:59:00Z", 60)]
    [InlineData("9999-12-31T20:00:00Z", 480)]
    public async Task Beyond_horizon_start_near_DateTime_MaxValue_returns_422(string start, int durationMinutes)
    {
        var service = TestData.NewServiceType("MAX-DATE-SERVICE", durationMinutes, [BayCapability.StandardLift], [Certification.GeneralService]);
        await SaveAsync(service);

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(service.Id, Utc(start)));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "beyond-booking-horizon", Ct);
        problem.GetProperty("latestStartUtc").GetString().ShouldBe("2027-01-10T08:00:00Z");
        await ShouldHaveNoAppointmentsAsync();
    }

    [Theory]
    [InlineData("2026-10-11T10:00:00Z", "outside-operating-hours")] // past and closed: hours retain precedence over lead time
    [InlineData("2026-10-12T08:10:00Z", "lead-time-not-met")] // inside hours, inside lead time, off grid
    [InlineData("0001-01-01T10:00:00Z", "lead-time-not-met")] // earliest supported calendar date, no underflow/500
    public async Task Normal_rule_order_is_preserved_after_the_early_horizon_guard(string start, string problemType)
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder.UseSetting("Scheduling:MinimumLeadTime", "01:00:00"));
        using var client = factory.CreateClient();

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc(start)), client: client);

        await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, problemType, Ct);
    }

    [Fact]
    public async Task Rejects_off_grid_start_422()
    {
        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc("2026-10-13T10:10:00Z")));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "slot-not-aligned", Ct);
        problem.GetProperty("slotGranularityMinutes").GetInt32().ShouldBe(15);
    }

    [Fact]
    public async Task Rejects_no_qualified_resources_422_with_missing_lists()
    {
        var ev = TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        await SaveAsync(ev);

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(ev.Id, Ten));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct);
        problem.GetProperty("missingCapabilities").GetRawText().ShouldBe("""["EvHighVoltage"]""");
        problem.GetProperty("missingCertifications").GetRawText().ShouldBe("""["HighVoltageElectrical"]""");
        var detail = problem.GetProperty("detail").GetString().ShouldNotBeNull();
        detail.ShouldNotContain("Amelia");
        detail.ShouldNotContain("Bay 1");
    }

    [Fact]
    public async Task Rejects_no_qualified_resources_when_only_the_technician_side_is_missing()
    {
        var ev = TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        await SaveAsync(ev, TestData.NewBay(_workshop.Dealership.Id, "EV Bay", BayCapability.EvHighVoltage));

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(ev.Id, Ten));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct);
        problem.GetProperty("missingCapabilities").GetRawText().ShouldBe("[]");
        problem.GetProperty("missingCertifications").GetRawText().ShouldBe("""["HighVoltageElectrical"]""");
    }

    [Fact]
    public async Task Returns_409_slot_unavailable_with_suggestions_when_all_busy()
    {
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1));
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2));

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 3));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Slot unavailable");
        var suggestions = Suggestions(problem);
        suggestions.Count.ShouldBe(3); // Scheduling:SuggestedSlotCount
        suggestions.ShouldAllBe(s => s.StartUtc >= Ten.AddHours(1) || s.EndUtc <= Ten, "none overlaps 10:00–11:00Z");
        // Nearest first, ties to the earlier slot: 09:00Z and 11:00Z are 60 minutes away, then 08:45Z and 11:15Z.
        suggestions.Select(s => s.StartUtc).ShouldBe([Ten.AddHours(-1), Ten.AddHours(1), Ten.AddMinutes(-75)]);
        suggestions[0].ShouldBe(new SuggestedSlotView(Ten.AddHours(-1), Ten, "2026-10-13T10:00+01:00"));
        await _factory.WithDbAsync(async db => (await db.Appointments.CountAsync(Ct)).ShouldBe(2));
    }

    [Theory]
    [InlineData("bay")]
    [InlineData("technician")]
    public async Task Suggestions_use_only_active_qualified_resources(string side)
    {
        // Busy at 10:00Z: the dealership's only active qualified resource on one side. The other side has a spare, so a dormant or
        // unqualified resource on the scarce side, if the suggestions counted it, would make 09:45Z and 10:15Z look free.
        var dealership = TestData.NewDealership("Sparse Motors");
        var bay = TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift);
        var technician = TestData.NewTechnician(dealership.Id, "Amelia Clarke", "S-1001", Certification.GeneralService);
        object[] scarceSideExtras = side == "bay"
            ?
            [
                ServiceBay.Create(Guid.NewGuid(), dealership.Id, "Bay 2 - Dormant", [BayCapability.StandardLift], isActive: false),
                TestData.NewBay(dealership.Id, "Bay 3 - MOT", BayCapability.MotTesting),
                TestData.NewTechnician(dealership.Id, "Chloe Nguyen", "S-1002", Certification.GeneralService),
            ]
            :
            [
                Technician.Create(Guid.NewGuid(), dealership.Id, "Ben Okafor", "S-1002", [Certification.GeneralService], isActive: false),
                TestData.NewTechnician(dealership.Id, "Farid Haddad", "S-1003", Certification.MotTester),
                TestData.NewBay(dealership.Id, "Bay 4", BayCapability.StandardLift),
            ];
        await SaveAsync([dealership, bay, technician, .. scarceSideExtras]);
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1, preferredBayId: bay.Id), dealership.Id);

        using var response = await PostAsync(dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2));

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct);
        Suggestions(problem).Select(s => s.StartUtc).ShouldBe([Ten.AddHours(-1), Ten.AddHours(1), Ten.AddMinutes(-75)]);
    }

    [Fact]
    public async Task Suggestions_are_bookable_now()
    {
        // Booking later today (now is 09:00Z): the nearest free starts include one already in the past, which is not offered.
        _factory.Clock.SetUtcNow(new DateTimeOffset(2026, 10, 13, 9, 0, 0, TimeSpan.Zero));
        var dealership = TestData.NewDealership("Single Bay Motors");
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "S-1001", Certification.GeneralService));
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), dealership.Id);

        using var response = await PostAsync(dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2));

        // Free starts nearest 10:00Z: 09:00Z and 11:00Z (60 minutes away), then 08:45Z (in the past, dropped) and 11:15Z.
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct);
        Suggestions(problem).Select(s => s.StartUtc).ShouldBe([Ten.AddHours(-1), Ten.AddHours(1), Ten.AddMinutes(75)]);
    }

    [Fact]
    public async Task Returns_400_validation_for_bad_vin_and_email()
    {
        var valid = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        var request = valid with { Customer = valid.Customer with { Email = "not-an-email" }, Vehicle = valid.Vehicle with { Vin = "WVWZZZ1KZAI123456" } };

        using var response = await PostAsync(_workshop.Dealership.Id, request);

        var problem = await response.ShouldBeValidationErrorAsync(["customer.email", "vehicle.vin"], Ct);
        problem.GetProperty("title").GetString().ShouldBe("Validation failed");
        problem.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments");
        await ShouldHaveNoAppointmentsAsync();
    }

    [Theory]
    [InlineData("2026-10-13T11:00:00+01:00")] // the same instant with an offset: deserialised as machine-local time, not UTC
    [InlineData("2026-10-13T10:00:00")] // no zone at all
    [InlineData("2026-10-13T10:00:30Z")] // not a whole minute
    public async Task Rejects_a_start_that_is_not_a_whole_utc_minute_400(string startUtc)
    {
        var json = JsonSerializer.Serialize(TestData.BookingRequest(_workshop.Interim.Id, Ten), SchedulerJsonContext.Default.BookAppointmentRequest)
            .Replace("\"2026-10-13T10:00:00Z\"", $"\"{startUtc}\"", StringComparison.Ordinal);

        using var response = await _client.PostAsync(Url(_workshop.Dealership.Id), new StringContent(json, Encoding.UTF8, "application/json"), Ct);

        await response.ShouldBeValidationErrorAsync(["startUtc"], Ct);
    }

    [Fact]
    public async Task Rejects_an_unreadable_body_400()
    {
        using var response = await _client.PostAsync(Url(_workshop.Dealership.Id), new StringContent("{ not json", Encoding.UTF8, "application/json"), Ct);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation-error", Ct);
        problem.GetProperty("errors").EnumerateObject().ShouldBeEmpty();
    }

    [Fact]
    public async Task Returns_404_for_unknown_dealership_and_service_type()
    {
        var unknownDealership = Guid.Parse("0199d2a4-0000-7000-8000-00000000dead");
        using (var response = await PostAsync(unknownDealership, TestData.BookingRequest(_workshop.Interim.Id, Ten)))
        {
            var problem = await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "not-found", Ct);
            problem.GetProperty("resource").GetString().ShouldBe("dealership");
            problem.GetProperty("id").GetGuid().ShouldBe(unknownDealership);
        }

        var unknownService = Guid.Parse("0199d2a4-0000-7000-8000-00000000beef");
        using (var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(unknownService, Ten)))
        {
            var problem = await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "not-found", Ct);
            problem.GetProperty("resource").GetString().ShouldBe("service-type");
            problem.GetProperty("id").GetGuid().ShouldBe(unknownService);
        }
    }

    [Fact]
    public async Task Constraint_backstop_maps_to_409_slot_conflict_for_out_of_band_row()
    {
        // The locked pre-check reads only rows whose dealership_id is the route's. An out-of-band writer that books dealership A's Bay 1
        // and Amelia under dealership B's id is invisible to it, but the exclusion constraints index bay_id and technician_id alone.
        var elsewhere = TestData.NewDealership("Elsewhere Motors");
        await SaveAsync(elsewhere);
        await InsertOutOfBandAppointmentAsync(elsewhere.Id, _workshop.Bay1.Id, _workshop.Technician1.Id, Ten, Ten.AddHours(1));
        using var metrics = new MetricsCollector();
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();

        using var response = await PostAsync(
            _workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, preferredBayId: _workshop.Bay1.Id), client: client);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-conflict", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Slot conflict");
        problem.GetProperty("conflictingResource").GetString().ShouldBeOneOf("bay", "technician");
        var suggestions = Suggestions(problem);
        suggestions.ShouldNotBeEmpty();
        suggestions.ShouldNotContain(s => s.StartUtc == Ten, "the requested slot itself is never suggested");

        metrics.Sum("scheduler.booking.constraint_backstop").ShouldBe(1);
        metrics.Of("scheduler.booking.constraint_backstop").ShouldHaveSingleItem().Tag("constraint").ShouldBeOneOf(
            PostgresErrorClassifier.BayConstraint, PostgresErrorClassifier.TechnicianConstraint);
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "slot_conflict")).ShouldBe(1);
        metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0);

        // A handled refusal is a Warning (1003), not an error: EF Core's own failed-save and command-error logs are lowered to Information.
        logs.Entries.ShouldNotContain(e => e.Level >= LogLevel.Error, string.Join(Environment.NewLine, logs.Entries.Where(e => e.Level >= LogLevel.Error)));
        logs.Entries.ShouldContain(e => e.EventId.Id == 1003 && e.Level == LogLevel.Warning);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(a => a.DealershipId == _workshop.Dealership.Id, Ct)).ShouldBe(0);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(0, "the rolled-back booking leaves no audit row");
            (await db.AppointmentHistory.CountAsync(h => !db.Appointments.Any(a => a.Id == h.AppointmentId), Ct)).ShouldBe(0);
        });
    }

    [Fact]
    public async Task Deadlock_on_the_insert_is_answered_once_as_a_slot_conflict_and_never_retried()
    {
        // ADR-003 rules a 40P01 out on this path; if one happened, it must be reported (409, metric, Warning 1004), not retried as the
        // execution strategy would retry any transient error, which a deadlock is to Npgsql.
        var deadlock = new SqlStateInjector("INSERT INTO appointments", "40P01");
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ILoggerProvider>(logs);
            services.ConfigureDbContext<SchedulerDbContext>(options => options.AddInterceptors(deadlock));
        }));
        using var client = factory.CreateClient();
        using var metrics = new MetricsCollector();

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten), client: client);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-conflict", Ct);
        problem.GetProperty("conflictingResource").GetString().ShouldBe("unknown");
        problem.GetProperty("suggestedSlots").GetArrayLength().ShouldBeGreaterThan(0);
        deadlock.Executions.ShouldBe(1, "a deadlock is answered, not handed to the execution strategy to retry");
        metrics.Sum("scheduler.booking.deadlocks").ShouldBe(1);
        metrics.Sum("scheduler.booking.constraint_backstop").ShouldBe(0);
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "slot_conflict")).ShouldBe(1);
        var warning = logs.Entries.Where(e => e.EventId.Id == 1004).ShouldHaveSingleItem();
        warning.Level.ShouldBe(LogLevel.Warning);
        warning.Exception.ShouldNotBeNull();
        await ShouldHaveNoAppointmentsAsync();
    }

    [Fact]
    public async Task Slot_conflict_exception_maps_to_409_problem()
    {
        using var response = await _client.GetAsync("/api/v1/__throw?kind=conflict", Ct);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-conflict", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Slot conflict");
    }

    [Fact]
    public async Task Records_outcomes_lock_wait_and_logs_rejections_without_pii()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        using var metrics = new MetricsCollector();
        var dealershipId = _workshop.Dealership.Id.ToString();

        (await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), client: client)).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2), client: client)).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 3), client: client)).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Utc("2026-10-13T10:10:00Z")), client: client)).StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        (await PostAsync(Guid.NewGuid(), TestData.BookingRequest(_workshop.Interim.Id, Ten), client: client)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var invalid = TestData.BookingRequest(_workshop.Interim.Id, Ten) with { Customer = new CustomerRequest("Jane Doe", "jane-at-example", "+44 7700 900999") };
        (await PostAsync(_workshop.Dealership.Id, invalid, client: client)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        Outcomes(metrics, dealershipId).ShouldBe(
            new Dictionary<string, long> { ["confirmed"] = 2, ["slot_unavailable"] = 1, ["rule_violation"] = 1, ["validation_failed"] = 1 },
            ignoreOrder: true);
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "not_found")).ShouldBe(1);
        metrics.Of("scheduler.booking.duration").Count.ShouldBe(5, "every request that reached the handler");
        metrics.Of("scheduler.booking.lock_wait", MetricsCollector.Tag("dealership.id", dealershipId)).Count.ShouldBe(3, "the three that passed the rule checks");

        var rejected = logs.Entries.Where(e => e.EventId.Id == 1002).Select(e => e.Message).ToList();
        rejected.Count.ShouldBe(4); // unavailable, rule, not found, validation
        rejected.ShouldContain(m => m.Contains("slot_unavailable", StringComparison.Ordinal) && m.Contains("INTERIM-SERVICE", StringComparison.Ordinal));
        logs.Entries.Count(e => e.EventId.Id == 1001).ShouldBe(2, "BookingConfirmed comes from the post-commit observer, once per booking");
        logs.Entries.ShouldNotContain(e => e.Message.Contains("Customer 3", StringComparison.Ordinal) || e.Message.Contains("jane-at-example", StringComparison.Ordinal)
            || e.Message.Contains(TestData.VinFor(3), StringComparison.Ordinal));
        logs.Entries.ShouldNotContain(e => e.Level >= LogLevel.Warning && e.Category.StartsWith("Keyloop", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Lock_wait_measures_real_time_spent_queued_behind_the_dealership_lock()
    {
        // The business clock is frozen (FakeTimeProvider); latencies must still be real elapsed time.
        using var metrics = new MetricsCollector();
        HttpResponseMessage response;
        await using (var connection = new NpgsqlConnection(pg.ConnectionString))
        {
            await connection.OpenAsync(Ct);
            await using var holder = await connection.BeginTransactionAsync(Ct);
            await using (var take = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, holder))
            {
                take.Parameters.AddWithValue("key", DealershipLock.KeyFor(_workshop.Dealership.Id));
                await take.ExecuteNonQueryAsync(Ct);
            }

            var inFlight = PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten));
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            await Task.Delay(TimeSpan.FromMilliseconds(250), Ct);
            await holder.CommitAsync(Ct);
            response = await inFlight;
        }

        using (response)
        {
            response.StatusCode.ShouldBe(HttpStatusCode.Created);
        }

        var wait = metrics.Of("scheduler.booking.lock_wait", MetricsCollector.Tag("dealership.id", _workshop.Dealership.Id.ToString())).ShouldHaveSingleItem();
        wait.Value.ShouldBeGreaterThanOrEqualTo(200, "queued for at least the 250 ms the test held the lock (less scheduling slack)");
        // The confirmed booking's own duration (outcome-tagged, so a measurement from any other request cannot satisfy it) includes the wait.
        metrics.Of("scheduler.booking.duration", MetricsCollector.Tag("outcome", "confirmed")).ShouldHaveSingleItem().Value.ShouldBeGreaterThanOrEqualTo(wait.Value);
    }

    [Fact]
    public async Task Booking_rate_limit_answers_429_with_Retry_After()
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:BookingPermitsPerMinute", "1"));
        using var client = factory.CreateClient();

        using var first = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), client: client);
        first.StatusCode.ShouldBe(HttpStatusCode.Created);

        using var second = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten.AddHours(1), customerIndex: 2), client: client);

        var problem = await second.ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rate-limited", Ct);
        var retryAfter = second.Headers.RetryAfter.ShouldNotBeNull().Delta.ShouldNotBeNull();
        retryAfter.ShouldBeInRange(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(60));
        problem.GetProperty("retryAfterSeconds").GetInt32().ShouldBe((int)retryAfter.TotalSeconds);
        await _factory.WithDbAsync(async db => (await db.Appointments.CountAsync(Ct)).ShouldBe(1));

        using var read = await client.GetAsync($"/api/v1/dealerships/{_workshop.Dealership.Id}/service-types", Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK, "the booking policy limits bookings only; reads stay under the global limiter");
    }

    private static Dictionary<string, long> Outcomes(MetricsCollector metrics, string dealershipId) =>
        metrics.Of("scheduler.booking.requests", MetricsCollector.Tag("dealership.id", dealershipId))
            .GroupBy(m => (string)m.Tag("outcome")!)
            .ToDictionary(g => g.Key, g => (long)g.Sum(m => m.Value));

    private static DateTime Utc(string iso) => DateTime.Parse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal);

    private static string Url(Guid dealershipId) => $"/api/v1/dealerships/{dealershipId}/appointments";

    private sealed record SuggestedSlotView(DateTime StartUtc, DateTime EndUtc, string StartLocal);

    private static List<SuggestedSlotView> Suggestions(JsonElement problem) =>
        [.. problem.GetProperty("suggestedSlots").EnumerateArray().Select(s => new SuggestedSlotView(
            s.GetProperty("startUtc").GetDateTime().ToUniversalTime(), s.GetProperty("endUtc").GetDateTime().ToUniversalTime(), s.GetProperty("startLocal").GetString()!))];

    private Task<HttpResponseMessage> PostAsync(Guid dealershipId, BookAppointmentRequest request, HttpClient? client = null) =>
        (client ?? _client).PostJsonAsync(Url(dealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);

    private async Task<AppointmentResponse> BookAsync(BookAppointmentRequest request, Guid? dealershipId = null)
    {
        using var response = await PostAsync(dealershipId ?? _workshop.Dealership.Id, request);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
    }

    private Task ShouldHaveNoAppointmentsAsync() => _factory.WithDbAsync(async db => (await db.Appointments.CountAsync(Ct)).ShouldBe(0));

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });

    private async Task InsertOutOfBandAppointmentAsync(Guid dealershipId, Guid bayId, Guid technicianId, DateTime startUtc, DateTime endUtc)
    {
        await using var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, status, created_at_utc, updated_at_utc,
                                      customer_name, customer_email, customer_phone, start_utc, end_utc,
                                      vehicle_vin, vehicle_registration, vehicle_make, vehicle_model)
            VALUES (@id, @dealership, @service, @bay, @technician, 'Confirmed', @now, @now,
                    'Out of band', 'oob@example.com', '+44 7700 900000', @start, @end,
                    'WVWZZZ1KZAW999999', 'OOB 1', 'Ford', 'Focus')
            """,
            connection);
        insert.Parameters.AddWithValue("id", Guid.CreateVersion7());
        insert.Parameters.AddWithValue("dealership", dealershipId);
        insert.Parameters.AddWithValue("service", _workshop.Interim.Id);
        insert.Parameters.AddWithValue("bay", bayId);
        insert.Parameters.AddWithValue("technician", technicianId);
        insert.Parameters.AddWithValue("now", TestData.Now);
        insert.Parameters.AddWithValue("start", startUtc);
        insert.Parameters.AddWithValue("end", endUtc);
        (await insert.ExecuteNonQueryAsync(Ct)).ShouldBe(1);
    }
}

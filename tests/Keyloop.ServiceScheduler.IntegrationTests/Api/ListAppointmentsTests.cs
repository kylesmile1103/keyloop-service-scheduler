using System.Globalization;
using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class ListAppointmentsTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
        _client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Inclusive_range_selects_local_start_dates_and_orders_by_start()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var before = Book(workshop, "2026-10-11T22:59:00Z");
        var first = Book(workshop, "2026-10-11T23:00:00Z", secondResource: true);
        var middle = Book(workshop, "2026-10-13T08:00:00Z");
        var last = Book(workshop, "2026-10-13T22:59:00Z");
        var after = Book(workshop, "2026-10-13T23:00:00Z", secondResource: true);
        var elsewhere = await WorkshopInZoneAsync("Europe/London", workshop);
        var otherDealership = Book(elsewhere, "2026-10-13T08:00:00Z");
        await SaveAsync(after, last, middle, first, before, otherDealership);

        using var body = await GetAsync(workshop.Dealership.Id, "from=2026-10-12&to=2026-10-13");

        Ids(body).ShouldBe([first.Id, middle.Id, last.Id]);
        body.RootElement[0].GetProperty("startLocal").GetString().ShouldBe("2026-10-12T00:00+01:00");
        body.RootElement[2].GetProperty("endLocal").GetString().ShouldBe("2026-10-14T00:59+01:00");
    }

    [Theory]
    [InlineData("Europe/London", "2026-10-25", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z", "2026-10-25T00:00+01:00")]
    [InlineData("Europe/London", "2026-03-29", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z", "2026-03-29T00:00+00:00")]
    [InlineData("Europe/Berlin", "2026-10-13", "2026-10-12T22:00:00Z", "2026-10-13T22:00:00Z", "2026-10-13T00:00+02:00")]
    [InlineData("America/New_York", "2026-10-13", "2026-10-13T04:00:00Z", "2026-10-14T04:00:00Z", "2026-10-13T00:00-04:00")]
    public async Task Single_day_uses_dealership_midnights_including_DST(string zone, string date, string lower, string upper, string local)
    {
        var workshop = await WorkshopInZoneAsync(zone);
        var start = Utc(lower);
        var end = Utc(upper);
        var before = Book(workshop, start.AddMinutes(-1));
        var first = Book(workshop, start, secondResource: true);
        var last = Book(workshop, end.AddMinutes(-1));
        var after = Book(workshop, end, secondResource: true);
        await SaveAsync(after, last, first, before);

        using var body = await GetAsync(workshop.Dealership.Id, $"from={date}&to={date}");

        Ids(body).ShouldBe([first.Id, last.Id]);
        body.RootElement[0].GetProperty("startLocal").GetString().ShouldBe(local);
    }

    [Fact]
    public async Task Fall_back_includes_both_occurrences_with_distinct_offsets()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var first = Book(workshop, "2026-10-25T00:30:00Z");
        var second = Book(workshop, "2026-10-25T01:30:00Z");
        await SaveAsync(second, first);

        using var body = await GetAsync(workshop.Dealership.Id, "from=2026-10-25&to=2026-10-25");

        Ids(body).ShouldBe([first.Id, second.Id]);
        body.RootElement.EnumerateArray().Select(a => a.GetProperty("startLocal").GetString())
            .ShouldBe(["2026-10-25T01:30+01:00", "2026-10-25T01:30+00:00"]);
        body.RootElement[0].GetProperty("endLocal").GetString().ShouldBe("2026-10-25T01:30+00:00");
    }

    [Fact]
    public async Task No_filter_includes_every_status_and_repeated_statuses_form_a_union()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var appointments = Enum.GetValues<AppointmentStatus>().Select((status, index) =>
        {
            var appointment = Book(workshop, TestData.LondonTime(8).AddHours(index));
            switch (status)
            {
                case AppointmentStatus.CheckedIn: appointment.CheckIn(TestData.Now); break;
                case AppointmentStatus.InProgress: appointment.CheckIn(TestData.Now); appointment.Start(TestData.Now); break;
                case AppointmentStatus.Completed: appointment.CheckIn(TestData.Now); appointment.Start(TestData.Now); appointment.Complete(TestData.Now); break;
                case AppointmentStatus.Cancelled: appointment.Cancel("Test cancellation", TestData.Now); break;
                case AppointmentStatus.NoShow: appointment.MarkNoShow(appointment.Slot.EndUtc); break;
            }
            return appointment;
        }).ToArray();
        await SaveAsync(appointments.Cast<object>().ToArray());

        using var all = await GetAsync(workshop.Dealership.Id, "from=2026-10-13&to=2026-10-13");
        Ids(all).ShouldBe(appointments.Select(a => a.Id));
        all.RootElement.EnumerateArray().Select(a => a.GetProperty("status").GetString()).ShouldBe(Enum.GetNames<AppointmentStatus>());

        using var filtered = await GetAsync(workshop.Dealership.Id,
            "from=2026-10-13&to=2026-10-13&status=Completed&status=Cancelled&status=Completed");
        Ids(filtered).ShouldBe(appointments.Where(a => a.Status is AppointmentStatus.Completed or AppointmentStatus.Cancelled).Select(a => a.Id));

        using var single = await GetAsync(workshop.Dealership.Id, "from=2026-10-13&to=2026-10-13&status=NoShow");
        Ids(single).ShouldBe(appointments.Where(a => a.Status == AppointmentStatus.NoShow).Select(a => a.Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Bearer test-caller")]
    public async Task Response_has_summaries_and_masks_personal_data_for_callers_without_a_role(string? authorization)
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var appointment = Book(workshop, TestData.LondonTime(9), name: "  Alice   Louise Smith  ", id: TestData.PlateLookalikeId());
        await SaveAsync(appointment);
        if (authorization is not null)
        {
            _client.DefaultRequestHeaders.Add("Authorization", authorization);
        }

        using var body = await GetAsync(workshop.Dealership.Id, "from=2026-10-13&to=2026-10-13");

        body.RootElement.GetArrayLength().ShouldBe(1);
        var item = body.RootElement[0];
        item.EnumerateObject().Select(p => p.Name).ShouldBe(
            ["id", "status", "startUtc", "endUtc", "startLocal", "endLocal", "serviceType", "bay", "technician", "customerName", "vin", "registration"]);
        item.GetProperty("id").GetGuid().ShouldBe(appointment.Id);
        item.GetProperty("status").GetString().ShouldBe("Confirmed");
        item.GetProperty("startUtc").GetString().ShouldBe("2026-10-13T08:00:00Z");
        item.GetProperty("endUtc").GetString().ShouldBe("2026-10-13T09:00:00Z");
        item.GetProperty("startLocal").GetString().ShouldBe("2026-10-13T09:00+01:00");
        item.GetProperty("endLocal").GetString().ShouldBe("2026-10-13T10:00+01:00");
        item.GetProperty("customerName").GetString().ShouldBe("ALS");
        item.GetProperty("vin").GetString().ShouldBe("***********123456");
        item.GetProperty("registration").GetString().ShouldBe("*******");
        item.GetProperty("serviceType").GetRawText().ShouldBe(
            $$"""{"id":"{{workshop.Interim.Id}}","code":"INTERIM-SERVICE","name":"INTERIM-SERVICE","durationMinutes":60}""");
        item.GetProperty("bay").GetRawText().ShouldBe($$"""{"id":"{{workshop.Bay1.Id}}","name":"Bay 1"}""");
        item.GetProperty("technician").GetRawText().ShouldBe($$"""{"id":"{{workshop.Technician1.Id}}","name":"Amelia Clarke"}""");
        body.RootElement.GetRawText().ShouldNotContain("Alice");
        body.RootElement.GetRawText().ShouldNotContain("WVWZZZ1KZAW");
        body.RootElement.GetRawText().ShouldNotContain("AB12", Case.Sensitive);
        body.RootElement.GetRawText().ShouldNotContain("CDE", Case.Sensitive);
    }

    [Fact]
    public async Task Orders_by_start_then_id_whatever_the_physical_and_id_order()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var earliest = Book(workshop, TestData.LondonTime(8), id: IdAt(5));
        var tieLow = Book(workshop, TestData.LondonTime(10), id: IdAt(3));
        var tieHigh = Book(workshop, TestData.LondonTime(10), secondResource: true, id: IdAt(4));
        var latest = Book(workshop, TestData.LondonTime(12), id: IdAt(1));
        tieLow.Id.CompareTo(tieHigh.Id).ShouldBeLessThan(0);
        foreach (var appointment in new[] { latest, tieHigh, tieLow, earliest })
        {
            await SaveAsync(appointment);
        }

        using var body = await GetAsync(workshop.Dealership.Id, "from=2026-10-13&to=2026-10-13");

        Ids(body).ShouldBe([earliest.Id, tieLow.Id, tieHigh.Id, latest.Id]);
    }

    [Fact]
    public void Range_query_selects_only_the_summary_columns_of_service_bay_and_technician()
    {
        using var scope = _factory.Services.CreateScope();
        var handler = scope.ServiceProvider.GetRequiredService<ListAppointmentsHandler>();
        var sql = handler.RangeQuery(new ListAppointmentsQuery { DealershipId = Guid.NewGuid(), From = "2026-10-13", To = "2026-10-13" },
            TestData.LondonTime(0), TestData.LondonTime(23)).ToQueryString();

        sql.ShouldContain("duration_minutes", Case.Sensitive, "the service summary needs its duration");
        foreach (var column in new[] { "required_bay_capabilities", "required_certifications", "capabilities", "certifications", "employee_number", "is_active" })
        {
            sql.ShouldNotContain(column, Case.Sensitive, $"whole service, bay or technician entities are projected:{Environment.NewLine}{sql}");
        }
    }

    [Theory]
    [InlineData("from=2026-10-12&to=2026-12-12")]
    [InlineData("from=2025-01-01&to=2025-01-01")]
    [InlineData("from=0001-01-01&to=0001-01-01")]
    [InlineData("from=9999-12-31&to=9999-12-31")]
    public async Task Valid_range_without_appointments_returns_an_empty_array(string query)
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var body = await GetAsync(workshop.Dealership.Id, query);
        body.RootElement.GetRawText().ShouldBe("[]");
    }

    [Fact]
    public async Task Status_filter_without_matches_returns_an_empty_array()
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        await SaveAsync(Book(workshop, TestData.LondonTime(9)));
        using var body = await GetAsync(workshop.Dealership.Id, "from=2026-10-13&to=2026-10-13&status=Cancelled");
        body.RootElement.GetRawText().ShouldBe("[]");
    }

    [Theory]
    [InlineData("to=2026-10-13", "from")]
    [InlineData("from=&to=2026-10-13", "from")]
    [InlineData("from=2026-10-12", "to")]
    [InlineData("from=2026-10-12&to=", "to")]
    [InlineData("from=10%2F12%2F2026&to=2026-10-13", "from")]
    [InlineData("from=2026-02-30&to=2026-10-13", "from")]
    [InlineData("from=2026-10-12&to=2026-10-13T00%3A00", "to")]
    [InlineData("from=2026-10-14&to=2026-10-13", "to")]
    [InlineData("from=2026-10-12&to=2026-12-13", "to")]
    [InlineData("from=2026-10-12&to=2026-10-13&status=Unknown", "status")]
    [InlineData("from=2026-10-12&to=2026-10-13&status=Confirmed&status=Bad", "status")]
    [InlineData("from=2026-10-12&to=2026-10-13&status=1", "status")]
    [InlineData("from=2026-10-12&to=2026-10-13&status=", "status")]
    public async Task Invalid_query_returns_400_validation_error_with_field(string query, string field)
    {
        using var response = await _client.GetAsync(Url(Guid.NewGuid(), query), Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/validation-error");
        root.GetProperty("status").GetInt32().ShouldBe(400);
        root.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        root.GetProperty("errors").EnumerateObject().Select(p => p.Name).ShouldBe([field]);
        root.GetProperty("errors").GetProperty(field).GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Unknown_dealership_returns_404_not_found()
    {
        var unknown = Guid.NewGuid();
        using var response = await _client.GetAsync(Url(unknown, "from=2026-10-12&to=2026-10-13"), Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/not-found");
        root.GetProperty("resource").GetString().ShouldBe("dealership");
        root.GetProperty("id").GetGuid().ShouldBe(unknown);
        root.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{unknown}/appointments");
    }

    private async Task<TestData.Workshop> WorkshopInZoneAsync(string zone, TestData.Workshop? shared = null) => await _factory.WithDbAsync(async db =>
    {
        var original = shared ?? await TestData.WorkshopAsync(db);
        var dealership = TestData.NewDealership(timeZoneId: zone);
        var bay1 = TestData.NewBay(dealership.Id, "Bay 1", [.. original.Bay1.Capabilities]);
        var bay2 = TestData.NewBay(dealership.Id, "Bay 2", [.. original.Bay2.Capabilities]);
        var technician1 = TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", [.. original.Technician1.Certifications]);
        var technician2 = TestData.NewTechnician(dealership.Id, "Ben Okafor", "T-1002", [.. original.Technician2.Certifications]);
        db.AddRange(dealership, bay1, bay2, technician1, technician2);
        await db.SaveChangesAsync(Ct);
        return new TestData.Workshop(dealership, original.Interim, bay1, bay2, technician1, technician2);
    });

    private static Appointment Book(TestData.Workshop workshop, string start, bool secondResource = false) =>
        Book(workshop, Utc(start), secondResource);

    private static Appointment Book(TestData.Workshop workshop, DateTime start, bool secondResource = false, string name = "Alice Smith", Guid? id = null)
    {
        var slot = TimeSlot.FromStart(start, workshop.Interim.Duration);
        return Appointment.Book(id ?? Guid.CreateVersion7(), workshop.Dealership, workshop.Interim,
            secondResource ? workshop.Bay2 : workshop.Bay1, secondResource ? workshop.Technician2 : workshop.Technician1,
            slot, new OperatingWindow(slot.StartUtc, slot.EndUtc),
            new CustomerDetails(name, "alice@example.com", "+44 7700 900001"), TestData.Vehicle(), null, TestData.Now);
    }

    private static Guid IdAt(int millisecond) => Guid.CreateVersion7(TestData.DefaultNow.AddMilliseconds(millisecond));

    private static DateTime Utc(string value) => DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
    private static string Url(Guid dealershipId, string query) => $"/api/v1/dealerships/{dealershipId}/appointments?{query}";
    private static IEnumerable<Guid> Ids(JsonDocument body) => body.RootElement.EnumerateArray().Select(a => a.GetProperty("id").GetGuid());

    private async Task<JsonDocument> GetAsync(Guid dealershipId, string query)
    {
        using var response = await _client.GetAsync(Url(dealershipId, query), Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        response.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("application/json");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
    }

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });
}

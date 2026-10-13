using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class CustomerLookupTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private CapturingLoggerProvider _logs = null!;
    private TestData.Workshop _workshop = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private string Route => RouteFor(_workshop.Dealership.Id);
    private static string RouteFor(Guid id) => $"/api/v1/dealerships/{id}/customer-lookups";

    public async ValueTask InitializeAsync()
    {
        _logs = new CapturingLoggerProvider();
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock(), _logs);
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData("  ab12 c  ")]
    [InlineData("AB 12CDE")]
    [InlineData("aB")]
    [InlineData("ALICE@")]
    [InlineData(" alice@EXAMPLE. ")]
    [InlineData("+44 (7700) 900-123")]
    [InlineData("447700")]
    [InlineData("900123")]
    [InlineData("ALIce")]
    [InlineData("lou")]
    [InlineData("SMI")]
    public async Task Each_shape_and_normalization_finds_intake_fields(string query)
    {
        await SeedAsync();
        var found = (await FindAsync(query)).ShouldHaveSingleItem();
        found.Customer.ShouldBe(new("Alice Louise Smith", "Alice@Example.com", "+44 (7700) 900-123"));
        found.Vehicle.ShouldBe(new("WVWZZZ1KZAW123456", "AB12 CDE", "Volkswagen", "Golf"));
        found.LastVisitUtc.ShouldBe(TestData.LondonTime(9));
        found.LastVisitUtc.Kind.ShouldBe(DateTimeKind.Utc);
        found.Visits.ShouldBe(1);
    }

    [Theory]
    [InlineData("Al")]
    [InlineData("mith")]
    [InlineData("770090")]
    [InlineData("ZZ99")]
    [InlineData("%_")]
    public async Task Short_name_substring_middle_phone_and_wildcards_do_not_match(string query)
    {
        await SeedAsync();
        (await FindAsync(query)).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("Grace Hopper")]
    [InlineData("grace hop")]
    [InlineData("Hopper Grace")]
    [InlineData("  HOP\tGrAcE  ")]
    [InlineData("grace x hop")]
    [InlineData("grace grace hop")]
    public async Task Multi_word_names_require_every_long_word_prefix_in_any_order(string query)
    {
        await SeedAsync(name: "Grace Hopper");
        await SeedAsync(hour: 10, name: "Grace Murray", email: "murray@example.com");
        await SeedAsync(hour: 11, name: "Ada Hopper", email: "ada@example.com");
        (await FindAsync(query)).ShouldHaveSingleItem().Customer.Name.ShouldBe("Grace Hopper");
    }

    [Theory]
    [InlineData("Grace Ada")]
    [InlineData("race hop")]
    [InlineData("grace hoppers")]
    [InlineData("gr ho")]
    [InlineData("grace hop%")]
    public async Task Missing_prefixes_and_queries_with_only_short_words_do_not_match_names(string query)
    {
        await SeedAsync(name: "Grace Hopper");
        (await FindAsync(query)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Short_name_words_are_ignored_and_registration_uses_the_whole_query()
    {
        await SeedAsync(name: "Grace Hopper");
        await SeedAsync(hour: 10, name: "Grace Murray", email: "murray@example.com", registration: "GR HO123");
        (await FindAsync("grace ho")).Select(r => r.Customer.Name).ShouldBe(["Grace Murray", "Grace Hopper"]);
        (await FindAsync("gr ho")).ShouldHaveSingleItem().Customer.Name.ShouldBe("Grace Murray");
    }

    [Fact]
    public async Task Name_words_must_match_one_booking_before_pair_history_is_projected()
    {
        await SeedAsync(name: "Grace Murray");
        await SeedAsync(hour: 10, name: "Ada Hopper");
        (await FindAsync("grace hop")).ShouldBeEmpty();
        (await FindAsync("grace mur")).ShouldHaveSingleItem().Customer.Name.ShouldBe("Ada Hopper");
    }

    [Theory]
    [InlineData("+44 (7700) 900-123", "07700 900123")]
    [InlineData("07700 900123", "+44 (7700) 900-123")]
    [InlineData("0044 (7700) 900-123", "07700 900123")]
    [InlineData("07700 900123", "0044 (7700) 900-123")]
    [InlineData("+44 7700 900123", "0044 7700 900123")]
    [InlineData("0044 7700 900123", "+44 7700 900123")]
    [InlineData("+49 (151) 2345-6789", "0151 23456789")]
    [InlineData("0151 23456789", "+49 (151) 2345-6789")]
    [InlineData("0049 (151) 2345-6789", "0151 23456789")]
    [InlineData("0151 23456789", "0049 (151) 2345-6789")]
    [InlineData("+49 151 23456789", "0049 151 23456789")]
    [InlineData("0049 151 23456789", "+49 151 23456789")]
    [InlineData("+44 7700 900123", "0770090")]
    [InlineData("07700 900123", "+44 770090")]
    [InlineData("+49 151 23456789", "0151234")]
    [InlineData("0151 23456789", "+49 151234")]
    public async Task Uk_and_german_national_and_international_phones_match_both_ways(string stored, string query)
    {
        await SeedAsync(phone: stored);
        (await FindAsync(query)).ShouldHaveSingleItem().Customer.Phone.ShouldBe(stored);
    }

    [Theory]
    [InlineData("+44 (7700) 900-123", "900123")]
    [InlineData("07700 900123", "900123")]
    [InlineData("0044 7700 900123", "900123")]
    [InlineData("+49 (151) 2345-6789", "456789")]
    [InlineData("0151 23456789", "456789")]
    [InlineData("0049 151 23456789", "456789")]
    public async Task Partial_phone_suffix_keeps_matching_every_supported_format(string stored, string query)
    {
        await SeedAsync(phone: stored);
        (await FindAsync(query)).ShouldHaveSingleItem().Customer.Phone.ShouldBe(stored);
    }

    [Theory]
    [InlineData("90012")]
    [InlineData("+44 770")]
    [InlineData("07700")]
    [InlineData("012345")]
    public async Task Phone_matching_keeps_six_digit_minimum(string query)
    {
        await SeedAsync(phone: "+44 7700 900123");
        await SeedAsync(hour: 10, phone: "+44 12345 678901", email: "short@example.com");
        (await FindAsync(query)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Literal_email_wildcards_and_name_punctuation_match_without_expansion()
    {
        await SeedAsync(name: "Alice O'Neill", email: "alice%_tag@example.com");
        (await FindAsync("alice%@")).ShouldBeEmpty();
        (await FindAsync("alice%_tag@")).ShouldHaveSingleItem();
        (await FindAsync("o'ne")).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Old_matches_group_case_insensitive_email_and_vin_then_return_latest_fields_and_all_visits()
    {
        await SeedAsync();
        await SeedAsync(hour: 10, name: "Renamed Customer", email: "alice@example.COM", phone: "+33 123456789", registration: "ZX39 NEW", make: "Updated", model: "Newest");
        var latest = (await FindAsync("AB12")).ShouldHaveSingleItem();
        latest.Customer.ShouldBe(new("Renamed Customer", "alice@example.COM", "+33 123456789"));
        latest.Vehicle.ShouldBe(new("WVWZZZ1KZAW123456", "ZX39 NEW", "Updated", "Newest"));
        latest.LastVisitUtc.ShouldBe(TestData.LondonTime(10));
        latest.Visits.ShouldBe(2);
        (await FindAsync("alice@")).ShouldHaveSingleItem().ShouldBe(latest);
        (await FindAsync("900123")).ShouldHaveSingleItem().ShouldBe(latest);
        (await FindAsync("lou")).ShouldHaveSingleItem().ShouldBe(latest);
        await SeedAsync(hour: 11, vin: TestData.VinFor(2));
        await SeedAsync(hour: 12, email: "different@example.com");
        var pairs = await FindAsync("AB12");
        pairs.Count.ShouldBe(3);
        pairs.Select(p => p.Visits).ShouldBe([1L, 1L, 2L]);
    }

    [Fact]
    public async Task Matching_latest_and_count_reads_stay_in_the_route_dealership()
    {
        await SeedAsync();
        var otherDealership = TestData.NewDealership("Other Motors");
        await _factory.WithDbAsync(async db =>
        {
            db.Dealerships.Add(otherDealership);
            await db.SaveChangesAsync(Ct);
            // Existing resource FKs are valid; the terminal row bypasses active overlap rules, as imported history might.
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc,
                    customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                    status, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), {otherDealership.Id}, service_type_id, bay_id, technician_id, start_utc + interval '1 day',
                    end_utc + interval '1 day', 'Other Private Customer', customer_email, customer_phone, vehicle_vin,
                    vehicle_registration, vehicle_make, vehicle_model, 'Cancelled', created_at_utc, updated_at_utc
                FROM appointments
                """, Ct);
        });
        var local = (await FindAsync("alice@")).ShouldHaveSingleItem();
        local.Customer.Name.ShouldBe("Alice Louise Smith");
        local.Visits.ShouldBe(1);
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, "alice@", RouteFor(otherDealership.Id));
        var other = (await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListReturningCustomerResponse, Ct)).ShouldHaveSingleItem();
        other.Customer.Name.ShouldBe("Other Private Customer");
        other.Visits.ShouldBe(1);
    }

    [Theory]
    [InlineData(AppointmentStatus.Confirmed)]
    [InlineData(AppointmentStatus.CheckedIn)]
    [InlineData(AppointmentStatus.InProgress)]
    [InlineData(AppointmentStatus.Completed)]
    [InlineData(AppointmentStatus.Cancelled)]
    [InlineData(AppointmentStatus.NoShow)]
    public async Task Every_status_is_searchable(AppointmentStatus status)
    {
        await SeedAsync(status: status);
        (await FindAsync("AB12")).ShouldHaveSingleItem().Visits.ShouldBe(1);
    }

    [Fact]
    public async Task Limit_applies_after_grouping_and_ordering_latest_visits()
    {
        // Terminal appointments can share a slot. Two visits per pair must not consume two result slots.
        for (var n = 0; n < 12; n++)
        {
            await SeedAsync(hour: 8, vin: TestData.VinFor(n), email: $"limit{n}@example.com", status: AppointmentStatus.Cancelled);
            await SeedAsync(hour: 9 + n / 2, minute: n % 2 * 30, vin: TestData.VinFor(n), email: $"limit{n}@example.com", status: AppointmentStatus.Cancelled);
        }
        var result = await FindAsync("AB12");
        result.Count.ShouldBe(8);
        result.Select(r => r.Vehicle.Vin).ShouldBe(Enumerable.Range(4, 8).Reverse().Select(TestData.VinFor));
        result.ShouldAllBe(r => r.Visits == 2);
        result.Select(r => r.LastVisitUtc).ShouldBe(result.Select(r => r.LastVisitUtc).OrderDescending());
    }

    [Fact]
    public async Task Equal_start_uses_booking_id_descending_for_latest_and_result_order()
    {
        var earlier = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var later = Guid.Parse("00000000-0000-0000-0000-000000000002");
        await SeedAsync(id: earlier, name: "First Name", status: AppointmentStatus.Cancelled);
        await SeedAsync(id: later, name: "Latest Name", status: AppointmentStatus.Cancelled);
        (await FindAsync("AB12")).ShouldHaveSingleItem().Customer.Name.ShouldBe("Latest Name");
        await SeedAsync(id: Guid.Parse("00000000-0000-0000-0000-000000000003"), vin: TestData.VinFor(3), status: AppointmentStatus.Cancelled);
        (await FindAsync("AB12")).Select(r => r.Vehicle.Vin).ShouldBe([TestData.VinFor(3), "WVWZZZ1KZAW123456"]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" a ")]
    public async Task Invalid_query_is_a_safe_field_error(string? query)
    {
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, query!);
        await response.ShouldBeValidationErrorAsync(["query"], Ct);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    [Fact]
    public async Task Length_validation_trims_and_accepts_both_boundaries()
    {
        (await FindAsync(" AB ")).ShouldBeEmpty();
        (await FindAsync(" " + new string('a', 100) + " ")).ShouldBeEmpty();
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, new string('a', 101));
        var problem = await response.ShouldBeValidationErrorAsync(["query"], Ct);
        problem.ToString().ShouldNotContain(new string('a', 101));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"query\":23}")]
    [InlineData("{\"query\":")]
    public async Task Missing_or_malformed_body_is_400(string json)
    {
        using var client = _factory.CreateClient();
        using var body = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(Route, body, Ct);
        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation-error", Ct);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("Viewer", 403)]
    [InlineData("Unassigned", 403)]
    [InlineData("Admin", 200)]
    [InlineData("ServiceAdvisor", 200)]
    public async Task Only_booking_roles_receive_personal_data(string? role, int status)
    {
        await SeedAsync();
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        if (role is not null)
        {
            client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        }
        using var response = await PostAsync(client, "AB12");
        response.StatusCode.ShouldBe((HttpStatusCode)status);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        var body = await response.Content.ReadAsStringAsync(Ct);
        if (status == 200)
        {
            body.ShouldContain("Alice Louise Smith");
        }
        else
        {
            body.ShouldNotContain("Alice");
        }
    }

    [Fact]
    public async Task Empty_dealership_returns_empty_and_unknown_dealership_is_404()
    {
        (await FindAsync("AB12")).ShouldBeEmpty();
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, "AB12", RouteFor(Guid.NewGuid()));
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "not-found", Ct);
        problem.GetProperty("resource").GetString().ShouldBe("dealership");
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    [Fact]
    public async Task Lookup_shares_booking_budget_and_429_has_retry_after_and_no_store()
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "100").UseSetting("Security:RateLimiting:BookingPermitsPerMinute", "1"));
        using var client = host.CreateClient();
        using var first = await client.PostJsonAsync("/api/v1/vehicle-profiles/resolve",
            new Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile.ResolveVehicleProfileRequest(), SchedulerJsonContext.Default.ResolveVehicleProfileRequest, Ct);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var limited = await PostAsync(client, "AB12");
        await limited.ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rate-limited", Ct);
        limited.Headers.RetryAfter!.Delta.ShouldNotBeNull().ShouldBeGreaterThan(TimeSpan.Zero);
        limited.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    [Fact]
    public async Task Response_projects_only_intake_fields()
    {
        await SeedAsync();
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, "AB12");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var pair = body.RootElement[0];
        pair.EnumerateObject().Select(p => p.Name).ShouldBe(["customer", "vehicle", "lastVisitUtc", "visits"]);
        pair.GetProperty("customer").EnumerateObject().Select(p => p.Name).ShouldBe(["name", "email", "phone"]);
        pair.GetProperty("vehicle").EnumerateObject().Select(p => p.Name).ShouldBe(["vin", "registration", "make", "model"]);
    }

    [Theory]
    [InlineData("PrivacySentinel@", "Email")]
    [InlineData("+44 (7700) 654-321", "Phone")]
    [InlineData("ZX39 SECRET", "RegistrationOrName")]
    [InlineData("UniqueSentinel", "RegistrationOrName")]
    public async Task Query_and_returned_personal_data_never_reach_logs_or_activity_tags(string query, string kind)
    {
        await SeedAsync(name: "UniqueSentinel Customer", email: "PrivacySentinel@example.com", phone: "+44 (7700) 654-321", registration: "ZX39 SECRET");
        var activities = new List<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStopped = a =>
            {
                lock (activities)
                {
                    activities.Add(a);
                }
            },
        };
        ActivitySource.AddActivityListener(listener);
        (await FindAsync(query)).ShouldHaveSingleItem();
        using var client = _factory.CreateClient();
        using var invalid = await PostAsync(client, query + new string('x', 101));
        invalid.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var missing = await PostAsync(client, query, RouteFor(Guid.NewGuid()));
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var entries = _logs.Entries;
        var lookup = entries.Where(e => e.EventId.Id == 1500).ShouldHaveSingleItem();
        lookup.EventId.Name.ShouldBe("CustomerLookupCompleted");
        lookup.State.Single(s => s.Key == "QueryKind").Value!.ToString().ShouldBe(kind);
        lookup.State.Single(s => s.Key == "ResultCount").Value.ShouldBe(1);
        var output = string.Join('\n', entries.Select(e => $"{e.Message}\n{e.Exception}\n{string.Join(',', e.State)}\n{string.Join(',', e.Scopes)}"));
        lock (activities)
        {
            activities.ShouldNotBeEmpty("the listener must observe real request/database spans before checking their tags");
            output += string.Join('\n', activities.Select(a => $"{a.DisplayName}\n{string.Join(',', a.TagObjects)}\n{string.Join(',', a.Events.SelectMany(e => e.Tags))}"));
        }
        foreach (var value in new[] { query, "PrivacySentinel", "654321", "654-321", "ZX39 SECRET", "ZX39SECRET", "UniqueSentinel", "WVWZZZ1KZAW123456" })
        {
            output.ShouldNotContain(value, Case.Insensitive);
        }
    }

    private async Task<IReadOnlyList<ReturningCustomerResponse>> FindAsync(string query)
    {
        using var client = _factory.CreateClient();
        using var response = await PostAsync(client, query);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListReturningCustomerResponse, Ct);
    }

    private Task<HttpResponseMessage> PostAsync(HttpClient client, string query, string? route = null) =>
        client.PostJsonAsync(route ?? Route, new FindReturningCustomersRequest(query), SchedulerJsonContext.Default.FindReturningCustomersRequest, Ct);

    private async Task SeedAsync(int hour = 9, int minute = 0, string name = "Alice Louise Smith", string email = "Alice@Example.com",
        string phone = "+44 (7700) 900-123", string vin = "WVWZZZ1KZAW123456", string registration = "AB12 CDE", string make = "Volkswagen",
        string model = "Golf", AppointmentStatus status = AppointmentStatus.Confirmed, Guid? id = null)
    {
        await _factory.WithDbAsync(async db =>
        {
            var slot = TimeSlot.FromStart(TestData.LondonTime(hour, minute), _workshop.Interim.Duration);
            var appointment = Appointment.Book(id ?? Guid.NewGuid(), _workshop.Dealership, _workshop.Interim, _workshop.Bay1, _workshop.Technician1,
                slot, _workshop.Dealership.ResolveOperatingWindow(TestData.BookingDay)!.Value, new(name, email, phone), new(Vin.Create(vin), registration, make, model),
                "Private notes must not be returned", TestData.Now);
            if (status == AppointmentStatus.Cancelled)
            {
                appointment.Cancel("Private cancellation", TestData.Now);
            }
            if (status == AppointmentStatus.NoShow)
            {
                appointment.MarkNoShow(slot.EndUtc.AddHours(1));
            }
            if (status is AppointmentStatus.CheckedIn or AppointmentStatus.InProgress or AppointmentStatus.Completed)
            {
                appointment.CheckIn(TestData.Now);
            }
            if (status is AppointmentStatus.InProgress or AppointmentStatus.Completed)
            {
                appointment.Start(TestData.Now);
            }
            if (status == AppointmentStatus.Completed)
            {
                appointment.Complete(TestData.Now);
            }
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
        });
    }
}

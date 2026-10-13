using System.Net;
using System.Text.Json.Nodes;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Tests for <c>POST /api/v1/admin/demo/reseed</c>.</summary>
public sealed class ReseedDemoDataTests(PostgresFixture pg) : IAsyncLifetime
{
    private const string Route = "/api/v1/admin/demo/reseed";
    private const string KeyHeader = "X-Reseed-Key";
    private const string Key = "0123456789abcdef0123456789abcdef";

    private static readonly TimeZoneInfo Berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");

    private SchedulerApiFactory _factory = null!;
    private WebApplicationFactory<Program> _demo = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static TheoryData<Guid> DemoDealerships => new() { ReferenceDataSeed.ReadingDealershipId, ReferenceDataSeed.MunichDealershipId };

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _demo = Demo(seedDemoData: true, key: Key);
        _client = _demo.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _demo.DisposeAsync();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Right_key_replaces_the_demo_appointments_their_history_and_keys_with_the_demo_week()
    {
        var seeded = await AppointmentIdsAsync();
        seeded.ShouldNotBeEmpty("startup seeded the demo week");

        using (var cancel = await _client.PostJsonAsync(
                   $"/api/v1/appointments/{seeded[0]}/cancel", new CancelAppointmentRequest("Customer rescheduled"), SchedulerJsonContext.Default.CancelAppointmentRequest, Ct))
        {
            cancel.StatusCode.ShouldBe(HttpStatusCode.OK, await cancel.Content.ReadAsStringAsync(Ct));
        }

        await BookAsync(ReferenceDataSeed.ReadingDealershipId, TestData.LondonTime(16, 30), idempotencyKey: "demo-session-1");
        await BookAsync(ReferenceDataSeed.MunichDealershipId, LocalTimeConverter.ToUtc(TestData.BookingDay, new TimeOnly(10, 0), Berlin));

        using var response = await ReseedAsync(_client, Key);

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        response.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("application/json");
        using (var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)))
        {
            body.RootElement.GetProperty("appointmentsDeleted").GetInt32().ShouldBe(seeded.Count + 2);
            body.RootElement.GetProperty("appointmentsCreated").GetInt32().ShouldBe(seeded.Count);
        }

        await _factory.WithDbAsync(async db =>
        {
            var appointments = await db.Appointments.AsNoTracking().ToListAsync(Ct);
            appointments.Select(a => a.Id).ShouldBe(seeded, ignoreOrder: true);
            appointments.ShouldAllBe(a => a.Status == AppointmentStatus.Confirmed);

            var active = appointments.Where(a => a.IsActive).ToList();
            active.SelectMany(a => active.Where(b => b.Id != a.Id && a.Slot.Overlaps(b.Slot) && (a.BayId == b.BayId || a.TechnicianId == b.TechnicianId)))
                .ShouldBeEmpty();

            var history = await db.AppointmentHistory.AsNoTracking().ToListAsync(Ct);
            history.Select(h => h.AppointmentId).ShouldBe(seeded, ignoreOrder: true);
            history.ShouldAllBe(h => h.EventType == "Booked");
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0);
        });

        using var schedule = await _client.GetAsync(
            $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/schedule?date={TestData.BookingDay:yyyy-MM-dd}", Ct);
        var board = await schedule.Content.ReadJsonAsync(SchedulerJsonContext.Default.WorkshopScheduleResponse, Ct);
        board.Bays.Sum(b => b.Appointments.Count).ShouldBeInRange(4, 6);
    }

    [Theory]
    [InlineData("no header")]
    [InlineData("empty")]
    [InlineData("another key")]
    [InlineData("a prefix of the key")]
    [InlineData("the key and more")]
    [InlineData("the key in upper case")]
    public async Task Missing_or_wrong_key_is_answered_like_an_unknown_route_and_changes_nothing(string attempt)
    {
        var key = attempt switch
        {
            "no header" => null,
            "empty" => "",
            "another key" => "fedcba9876543210fedcba9876543210",
            "a prefix of the key" => Key[..^1],
            "the key and more" => Key + "0",
            "the key in upper case" => Key.ToUpperInvariant(),
            _ => throw new ArgumentOutOfRangeException(nameof(attempt), attempt, null),
        };
        var before = await BookMarkerAsync();
        using var client = _factory.CreateClient();
        using var unknownRoute = await ReseedAsync(client, Key);

        using var response = await ReseedAsync(_client, key);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        unknownRoute.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        response.Content.Headers.ContentType?.MediaType.ShouldBe(unknownRoute.Content.Headers.ContentType?.MediaType);
        var problem = WithoutTraceId(await response.Content.ReadAsStringAsync(Ct));
        JsonNode.DeepEquals(problem, WithoutTraceId(await unknownRoute.Content.ReadAsStringAsync(Ct)))
            .ShouldBeTrue($"a wrong key must not reveal the endpoint: {problem?.ToJsonString()}");
        (await AppointmentIdsAsync()).ShouldBe(before);
    }

    [Fact]
    public void Route_is_mapped_for_POST_only_with_demo_data_and_a_configured_key() =>
        ReseedEndpoints(_demo).ShouldHaveSingleItem().Metadata.GetMetadata<IHttpMethodMetadata>().ShouldNotBeNull().HttpMethods.ShouldBe(["POST"]);

    [Theory]
    [InlineData(false, Key)]
    [InlineData(true, null)]
    [InlineData(true, "")]
    public async Task Route_exists_only_with_demo_data_and_a_configured_key(bool seedDemoData, string? configuredKey)
    {
        await using var host = Demo(seedDemoData, configuredKey);
        using var client = host.CreateClient();
        var before = await BookMarkerAsync();

        foreach (var presented in new[] { null, "", Key })
        {
            using var response = await ReseedAsync(client, presented);
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound, $"X-Reseed-Key {(presented is null ? "absent" : $"'{presented}'")}");
        }

        (await AppointmentIdsAsync()).ShouldBe(before, "no request reseeded: the marker booking is still there");

        ReseedEndpoints(host).ShouldBeEmpty();
    }

    [Fact]
    public async Task Reseed_counts_against_the_write_rate_limit()
    {
        await using var host = Demo(seedDemoData: true, Key, builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:BookingPermitsPerMinute", "1"));
        using var client = host.CreateClient();
        using (var first = await ReseedAsync(client, Key))
        {
            first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync(Ct));
        }

        var before = await BookMarkerAsync();

        using var second = await ReseedAsync(client, Key);

        var problem = await second.ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rate-limited", Ct);
        problem.GetProperty("retryAfterSeconds").GetInt32().ShouldBeGreaterThan(0);
        (await AppointmentIdsAsync()).ShouldBe(before, "the limited reseed did not run");
    }

    [Fact]
    public async Task Route_is_left_out_of_the_OpenAPI_contract()
    {
        using var withoutRoute = _factory.CreateClient();
        var served = JsonNode.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct))!;
        var reference = JsonNode.Parse(await withoutRoute.GetStringAsync("/openapi/v1.json", Ct))!;

        served["paths"]!.AsObject().Select(p => p.Key).ShouldNotContain(path => path.StartsWith("/api/v1/admin/", StringComparison.Ordinal));
        JsonNode.DeepEquals(served, reference).ShouldBeTrue("the reseed route changed the OpenAPI document");
    }

    [Theory]
    [MemberData(nameof(DemoDealerships))]
    public async Task Reseed_waits_for_a_booking_in_flight_at_either_demo_dealership(Guid dealershipId)
    {
        await using var booking = new NpgsqlConnection(pg.ConnectionString);
        await booking.OpenAsync(Ct);
        await using var transaction = await booking.BeginTransactionAsync(Ct);
        await using (var takeLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", booking, transaction))
        {
            takeLock.Parameters.AddWithValue("key", DealershipLock.KeyFor(dealershipId));
            await takeLock.ExecuteNonQueryAsync(Ct);
        }

        var reseed = ReseedAsync(_client, Key);
        await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
        reseed.IsCompleted.ShouldBeFalse("the reseed must not delete the appointments under a booking in flight");

        await transaction.CommitAsync(Ct);
        using var response = await reseed;
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
    }

    private WebApplicationFactory<Program> Demo(bool seedDemoData, string? key, Action<IWebHostBuilder>? configure = null) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Database:SeedDemoData", seedDemoData ? "true" : "false");
            if (key is not null)
            {
                builder.UseSetting("Demo:ReseedKey", key);
            }

            configure?.Invoke(builder);
        });

    [Fact]
    public async Task Reseed_restores_seeded_competence_only_where_no_level_was_confirmed()
    {
        var amelia = ReferenceDataSeed.TechnicianId("T-1001");
        var ben = ReferenceDataSeed.TechnicianId("T-1002");
        var chloe = ReferenceDataSeed.TechnicianId("T-1003");
        var hans = ReferenceDataSeed.TechnicianId("M-2002");
        await _factory.WithDbAsync(async db =>
        {
            await db.Database.ExecuteSqlAsync($"""
                UPDATE technicians SET hv_level = 0, hv_level_valid_until = NULL, hv_level_confirmed = false, brand_specialisms = ARRAY[]::text[] WHERE id IN ({amelia}, {chloe});
                UPDATE technicians SET hv_level = 3, hv_level_valid_until = NULL, hv_level_confirmed = false, brand_specialisms = ARRAY[]::text[] WHERE id IN ({ben}, {hans});
                UPDATE technicians SET hv_level = 1, hv_level_valid_until = '2027-01-31', hv_level_confirmed = true WHERE id = {chloe};
                """, Ct);
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
        });
        (await CompetenceAsync(amelia)).ShouldBe((0, null, false), "startup seeding never rewrites an existing technician");

        using var response = await ReseedAsync(_client, Key);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));

        var validUntil = new DateOnly(2028, 12, 31);
        (await CompetenceAsync(amelia)).ShouldBe((2, validUntil, true));
        (await CompetenceAsync(ben)).ShouldBe((3, validUntil, true));
        (await CompetenceAsync(hans)).ShouldBe((3, validUntil, true));
        (await CompetenceAsync(chloe)).ShouldBe((1, new DateOnly(2027, 1, 31), true), "a confirmed level is kept");
        (await _factory.WithDbAsync(db => db.Technicians.AsNoTracking().SingleAsync(t => t.Id == amelia, Ct))).BrandSpecialisms.ShouldBe(["VOLKSWAGEN"]);
        (await _factory.WithDbAsync(db => db.Technicians.AsNoTracking().SingleAsync(t => t.Id == hans, Ct))).BrandSpecialisms.ShouldBe(["BMW"]);
    }

    [Fact]
    public async Task Reseed_restores_only_the_named_seeded_damage_certifications_and_keeps_confirmed_levels()
    {
        var eva = ReferenceDataSeed.TechnicianId("T-1005");
        var hans = ReferenceDataSeed.TechnicianId("M-2002");
        await _factory.WithDbAsync(async db =>
        {
            await db.Database.ExecuteSqlAsync($"""
                UPDATE technicians SET certifications = array_remove(certifications, 'DamageAssessment') WHERE id IN ({eva}, {hans});
                UPDATE technicians SET hv_level = 1, hv_level_confirmed = true, hv_level_valid_until = '2027-01-31' WHERE id = {eva};
                """, Ct);
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
        });
        (await _factory.WithDbAsync(db => db.Technicians.AsNoTracking().SingleAsync(t => t.Id == eva, Ct)))
            .Certifications.ShouldNotContain(Keyloop.ServiceScheduler.Domain.Resources.Certification.DamageAssessment);
        using var response = await ReseedAsync(_client, Key);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.WithDbAsync(async db =>
        {
            var technicians = await db.Technicians.AsNoTracking().ToListAsync(Ct);
            technicians.Where(t => t.Certifications.Contains(Keyloop.ServiceScheduler.Domain.Resources.Certification.DamageAssessment))
                .Select(t => t.Id).ShouldBe([eva, hans], ignoreOrder: true);
            var restored = technicians.Single(t => t.Id == eva);
            restored.Certifications.ShouldBe([Keyloop.ServiceScheduler.Domain.Resources.Certification.GeneralService,
                Keyloop.ServiceScheduler.Domain.Resources.Certification.AirConditioning, Keyloop.ServiceScheduler.Domain.Resources.Certification.Diagnostics,
                Keyloop.ServiceScheduler.Domain.Resources.Certification.DamageAssessment], ignoreOrder: true);
        });
        (await CompetenceAsync(eva)).ShouldBe((1, new DateOnly(2027, 1, 31), true));
    }

    [Fact]
    public async Task Reseed_keeps_competence_and_certifications_an_Admin_edited()
    {
        var amelia = ReferenceDataSeed.TechnicianId("T-1001");
        var ben = ReferenceDataSeed.TechnicianId("T-1002");
        var eva = ReferenceDataSeed.TechnicianId("T-1005");
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"UPDATE technicians SET hv_level = 3, hv_level_valid_until = NULL, hv_level_confirmed = false WHERE id = {ben}", Ct));
        await EditTechnicianAsync(amelia, body =>
        {
            body["hvLevel"] = 1;
            body["hvLevelValidUntil"] = null;
            body["hvLevelConfirmed"] = false;
        });
        await EditTechnicianAsync(eva, body => body["certifications"] = new JsonArray([.. body["certifications"]!.AsArray()
            .Select(c => c!.GetValue<string>()).Where(c => c != "DamageAssessment").Select(c => (JsonNode)JsonValue.Create(c))]));

        using var response = await ReseedAsync(_client, Key);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));

        (await CompetenceAsync(amelia)).ShouldBe((1, null, false), "an Admin's unconfirmed level is a person's decision");
        (await CompetenceAsync(ben)).ShouldBe((3, new DateOnly(2028, 12, 31), true));
        (await _factory.WithDbAsync(db => db.Technicians.AsNoTracking().SingleAsync(t => t.Id == eva, Ct)))
            .Certifications.ShouldNotContain(Keyloop.ServiceScheduler.Domain.Resources.Certification.DamageAssessment);
    }

    private async Task EditTechnicianAsync(Guid technicianId, Action<JsonNode> edit)
    {
        var path = $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/technicians/{technicianId}";
        using var read = await _client.GetAsync(path, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK, await read.Content.ReadAsStringAsync(Ct));
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        edit(body);
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("If-Match", read.Headers.ETag!.ToString());
        using var saved = await _client.SendAsync(request, Ct);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
    }

    [Fact]
    public async Task Reseed_logs_each_published_policy_once_after_commit_and_nothing_for_a_rolled_back_attempt()
    {
        var probe = new PolicyPublicationProbe(pg.ConnectionString);
        var loss = new CommitAcknowledgementLoss { BeforeCommit = true };
        await using var host = Demo(seedDemoData: true, key: Key, builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<ILoggerProvider>(probe);
            services.ConfigureDbContext<SchedulerDbContext>(options => options.AddInterceptors(loss));
        }));
        using var client = host.CreateClient();
        await _factory.WithDbAsync(db => PolicyPublicationProbe.RevertToBeforeTask32aAsync(db, Ct));

        loss.Arm();
        using var response = await ReseedAsync(client, Key);

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        loss.Fired.ShouldBe(1);
        probe.Lines.Select(line => (line.DealershipId, line.Version, line.Previous, line.Committed)).ShouldBe([
            (ReferenceDataSeed.ReadingDealershipId, 2, 1, true),
            (ReferenceDataSeed.MunichDealershipId, 2, 1, true),
        ], ignoreOrder: true);
        (await _factory.WithDbAsync(db => db.RequirementRules.AsNoTracking().CountAsync(r => r.PolicyVersion == 2, Ct))).ShouldBe(14);
    }

    private Task<(int Level, DateOnly? ValidUntil, bool Confirmed)> CompetenceAsync(Guid technicianId) =>
        _factory.WithDbAsync(async db =>
        {
            var technician = await db.Technicians.AsNoTracking().SingleAsync(t => t.Id == technicianId, Ct);
            return (technician.HvLevel, technician.HvLevelValidUntil, technician.HvLevelConfirmed);
        });

    private static List<RouteEndpoint> ReseedEndpoints(WebApplicationFactory<Program> host) =>
        host.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText == Route)
            .ToList();

    private static async Task<HttpResponseMessage> ReseedAsync(HttpClient client, string? key)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Route);
        if (key is not null)
        {
            request.Headers.Add(KeyHeader, key);
        }

        return await client.SendAsync(request, Ct);
    }

    private async Task BookAsync(Guid dealershipId, DateTime startUtc, string? idempotencyKey = null)
    {
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), startUtc, customerIndex: 7);
        var headers = idempotencyKey is null ? null : new Dictionary<string, string> { ["Idempotency-Key"] = idempotencyKey };
        using var response = await _client.PostJsonAsync(
            $"/api/v1/dealerships/{dealershipId}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
    }

    private async Task<List<Guid>> BookMarkerAsync()
    {
        await BookAsync(ReferenceDataSeed.ReadingDealershipId, TestData.LondonTime(16, 30));
        var ids = await AppointmentIdsAsync();
        ids.Count.ShouldBeGreaterThan(1, "the demo week and the marker");
        return ids;
    }

    private Task<List<Guid>> AppointmentIdsAsync() =>
        _factory.WithDbAsync(db => db.Appointments.AsNoTracking().OrderBy(a => a.Id).Select(a => a.Id).ToListAsync(Ct));

    private static JsonNode? WithoutTraceId(string json)
    {
        var node = JsonNode.Parse(json);
        node?.AsObject().Remove("traceId");
        return node;
    }
}

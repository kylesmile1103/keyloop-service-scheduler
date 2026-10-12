using System.Net;
using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Domain.Resources;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class VehicleAwareBookingTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private CapturingLoggerProvider _logs = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    public async ValueTask InitializeAsync()
    {
        _logs = new CapturingLoggerProvider();
        _factory = new(pg.ConnectionString, TestData.Clock(), _logs);
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }
    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
        _logs.Dispose();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Every_seeded_Reading_service_is_bookable_for_ICE_and_Unknown(bool unknown)
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var services = await _factory.WithDbAsync(db => db.ServiceTypes.AsNoTracking().ToListAsync(Ct));
        foreach (var service in services)
        {
            var request = TestData.BookingRequest(service.Id, TestData.LondonTime(10));
            var json = JsonSerializer.SerializeToNode(request, SchedulerJsonContext.Default.BookAppointmentRequest)!.AsObject();
            // Build explicit JSON without reflection-based serialization in this process.
            if (!unknown)
            {
                json["vehicle"]!["profile"] = System.Text.Json.Nodes.JsonNode.Parse("{\"powertrain\":\"Ice\",\"declarationReason\":\"Verified at intake\"}");
            }
            using var response = await client.PostAsync($"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/appointments",
                new StringContent(json.ToJsonString(), Encoding.UTF8, "application/json"), Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.Created, service.Code + await response.Content.ReadAsStringAsync(Ct));
            var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
            booked.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(1);
            await _factory.WithDbAsync(async db =>
            {
                var row = await db.Appointments.SingleAsync(a => a.Id == booked.Id, Ct);
                row.Cancel("Test case complete", TestData.Now);
                await db.SaveChangesAsync(Ct);
            });
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Live_diagnosis_returns_the_honest_level_four_training_gap(bool declareIce)
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("EV-BATTERY-CHECK"), TestData.LondonTime(10)) with { NeedsLiveDiagnosis = true };
        if (declareIce)
        {
            request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: "Engine verified at intake") } };
        }
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/appointments", request,
            SchedulerJsonContext.Default.BookAppointmentRequest, ct: Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        body.RootElement.GetProperty("minimumHvLevel").GetInt32().ShouldBe(4);
        body.RootElement.GetProperty("requiredBrand").ValueKind.ShouldBe(JsonValueKind.Null);
        body.RootElement.GetProperty("firedRules").EnumerateArray().Select(r => r.GetString()).ShouldContain("hv-live-diagnosis");
    }

    [Theory]
    [InlineData("Anonymous", 401)]
    [InlineData("Unknown", 403)]
    [InlineData("Viewer", 403)]
    [InlineData("ServiceAdvisor", 200)]
    [InlineData("Admin", 200)]
    public async Task Resolution_requires_booking_write_and_never_echoes_or_stores_identifiers(string role, int status)
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        using var response = await client.PostJsonAsync("/api/v1/vehicle-profiles/resolve", new ResolveVehicleProfileRequest("WVWZZZ1KZAW123456", "AB12 CDE"),
            SchedulerJsonContext.Default.ResolveVehicleProfileRequest, Ct);
        ((int)response.StatusCode).ShouldBe(status);
        var body = await response.Content.ReadAsStringAsync(Ct);
        body.ShouldNotContain("WVWZZZ1KZAW123456");
        body.ShouldNotContain("AB12 CDE");
        if (status == 200)
        {
            var profile = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.VehicleProfile, Ct);
            profile.Manufacturer.ShouldBe("VOLKSWAGEN");
            profile.Provenance.Manufacturer.ShouldBe(ProfileSource.VinDecoded);
            profile.Powertrain.ShouldBe(Powertrain.Unknown);
            profile.VehicleClass.ShouldBe(VehicleClass.Unknown);
        }
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(0);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(0);
        });
        string.Join('\n', _logs.Entries.Select(e => e.Message)).ShouldNotContain("WVWZZZ1KZAW123456");
        string.Join('\n', _logs.Entries.Select(e => e.Message)).ShouldNotContain("AB12 CDE");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Decoded_manufacturer_conflict_requires_explicit_choice(bool chooseDecoded)
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10));
        request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, "BMW", DeclarationReason: "Checked engine",
            ConflictChoice: chooseDecoded ? ProfileConflictChoice.UseDecoded : null) } };
        using var response = await client.PostJsonAsync(BookingUrl(ReferenceDataSeed.ReadingDealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(chooseDecoded ? HttpStatusCode.Created : HttpStatusCode.UnprocessableEntity);
        if (chooseDecoded)
        {
            var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
            booked.Vehicle.Profile.ShouldNotBeNull().Manufacturer.ShouldBe("VOLKSWAGEN");
            booked.Vehicle.Profile.Provenance.Manufacturer.ShouldBe(ProfileSource.VinDecoded);
        }
        else
        {
            using var body = await response.ReadProblemAsync(Ct);
            body.RootElement.GetProperty("type").GetString().ShouldEndWith("/vehicle-profile-conflict");
            (await _factory.WithDbAsync(db => db.Appointments.CountAsync(Ct))).ShouldBe(0);
        }
    }

    [Fact]
    public async Task Declared_powertrain_has_private_accountability_and_stable_idempotent_audit()
    {
        const string reason = "Private intake reason: customer Jane said the engine is diesel";
        using var metrics = new MetricsCollector();
        var spanTags = new List<string>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStopped = a => { lock (spanTags) { spanTags.AddRange(a.TagObjects.Select(t => $"{t.Key}:{t.Value}")); } },
        };
        ActivitySource.AddActivityListener(listener);
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10));
        request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: reason) } };
        using var response = await client.PostJsonAsync(BookingUrl(ReferenceDataSeed.ReadingDealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest,
            new Dictionary<string, string> { ["Idempotency-Key"] = "private-declaration" }, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        var provenance = booked.Vehicle.Profile.ShouldNotBeNull().Provenance;
        provenance.Powertrain.ShouldBe(ProfileSource.Declared);
        provenance.DeclaredBy.ShouldBe("user:test-user@keyloop.test");
        provenance.DeclarationReason.ShouldBe(reason);
        using var replay = await client.PostJsonAsync(BookingUrl(ReferenceDataSeed.ReadingDealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest,
            new Dictionary<string, string> { ["Idempotency-Key"] = "private-declaration" }, Ct);
        replay.StatusCode.ShouldBe(HttpStatusCode.Created);
        replay.Headers.Contains("Idempotent-Replayed").ShouldBeTrue();
        using var detail = await client.GetAsync($"/api/v1/appointments/{booked.Id}", Ct);
        (await detail.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).ShouldBe(booked);
        await _factory.WithDbAsync(async db =>
        {
            var history = await db.AppointmentHistory.SingleAsync(h => h.AppointmentId == booked.Id, Ct);
            history.Actor.ShouldBe(provenance.DeclaredBy);
            history.Payload.ShouldContain("Private intake reason");
            var row = await db.Appointments.SingleAsync(a => a.Id == booked.Id, Ct);
            row.VehicleProfile.Provenance.ShouldBe(provenance);
            var outbox = await db.NotificationOutbox.SingleAsync(n => n.AppointmentId == booked.Id, Ct);
            outbox.Payload.ShouldNotContain(reason);
            outbox.Payload.ShouldNotContain("test-user");
        });
        foreach (var route in new[] { $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/schedule?date=2026-10-13",
            $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/appointments?from=2026-10-13&to=2026-10-13" })
        {
            client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
            var publicBody = await client.GetStringAsync(route, Ct);
            publicBody.ShouldNotContain(reason);
            publicBody.ShouldNotContain(request.Vehicle.Vin);
            publicBody.ShouldNotContain(request.Vehicle.Registration);
            publicBody.ShouldNotContain("test-user");
        }
        metrics.Sum("scheduler.allocation.decided_by").ShouldBe(1);
        metrics.Sum("scheduler.allocation.below_hv_minimum").ShouldBe(0);
        foreach (var instrument in new[] { "scheduler.intake.profile_source", "scheduler.requirements.rule_fired", "scheduler.allocation.decided_by" })
        {
            string.Join('\n', metrics.Of(instrument).SelectMany(m => m.Tags).Select(t => $"{t.Key}:{t.Value}")).ShouldNotContain(reason);
        }
        string.Join('\n', _logs.Entries.Select(e => e.Message)).ShouldNotContain(reason);
        string.Join('\n', spanTags).ShouldNotContain(reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Concrete_powertrain_requires_a_reason(string? reason)
    {
        using var client = _factory.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10));
        request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: reason) } };
        using var response = await client.PostJsonAsync(BookingUrl(ReferenceDataSeed.ReadingDealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData(12, 422)]
    [InlineData(13, 201)]
    public async Task Competence_expires_on_the_local_appointment_date_not_UTC_or_today(int expiryDay, int status)
    {
        var site = TestData.NewDealership(timeZoneId: "Pacific/Kiritimati");
        var bay = TestData.NewBay(site.Id, "Bay", BayCapability.StandardLift);
        var technician = TestData.NewTechnician(site.Id, "Tech", "LOCAL", Certification.GeneralService);
        technician.SetCompetence(2, new DateOnly(2026, 10, expiryDay), false);
        var service = TestData.NewServiceType("INTERIM-SERVICE-LOCAL", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        // An explicit policy for this service exercises persisted policy rules and local-date qualification together.
        var rules = RequirementRule.DefaultPolicy(site.Id).Select(r => r.Code == "hv-routine" ? r with { ServiceCodes = [service.Code] } : r).ToArray();
        await _factory.WithDbAsync(async db => { db.AddRange(site, bay, technician, service); db.RequirementRules.AddRange(rules); await db.SaveChangesAsync(Ct); });
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var start = new DateTime(2026, 10, 12, 20, 0, 0, DateTimeKind.Utc); // 2026-10-13 10:00 local, 12th UTC.
        using var response = await client.PostJsonAsync(BookingUrl(site.Id), TestData.BookingRequest(service.Id, start), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        ((int)response.StatusCode).ShouldBe(status);
        var availability = await client.GetStringAsync($"/api/v1/dealerships/{site.Id}/availability?serviceTypeId={service.Id}&date=2026-10-13", Ct);
        using var body = JsonDocument.Parse(availability);
        (body.RootElement.GetProperty("slots").GetArrayLength() > 0).ShouldBe(status == 201);
    }

    [Theory]
    [InlineData(false, 201)]
    [InlineData(true, 422)]
    public async Task Flag_off_preserves_legacy_qualification_and_response_shape(bool enabled, int status)
    {
        await _factory.ResetAsync();
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", enabled.ToString()));
        using var client = host.CreateClient();
        using var response = await client.PostJsonAsync(BookingUrl(workshop.Dealership.Id), TestData.BookingRequest(workshop.Interim.Id, TestData.LondonTime(10)),
            SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        ((int)response.StatusCode).ShouldBe(status);
        if (!enabled)
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
            body.RootElement.TryGetProperty("allocation", out _).ShouldBeFalse();
            body.RootElement.GetProperty("vehicle").TryGetProperty("profile", out _).ShouldBeFalse();
            using var schedule = JsonDocument.Parse(await client.GetStringAsync($"/api/v1/dealerships/{workshop.Dealership.Id}/schedule?date=2026-10-13", Ct));
            schedule.RootElement.GetProperty("technicians")[0].TryGetProperty("hvLevel", out _).ShouldBeFalse(schedule.RootElement.ToString());
        }
    }

    [Fact]
    public async Task Latest_policy_is_used_and_the_booked_version_survives_a_later_policy_change()
    {
        var site = ReferenceDataSeed.ReadingDealershipId;
        await _factory.WithDbAsync(async db =>
        {
            var original = await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site).ToListAsync(Ct);
            db.RequirementRules.AddRange(original.Select(r => r with { Id = Guid.NewGuid(), PolicyVersion = 2,
                MinimumHvLevel = r.Code == "hv-routine" ? 3 : r.MinimumHvLevel }));
            await db.SaveChangesAsync(Ct);
        });
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10),
            preferredTechnicianId: ReferenceDataSeed.TechnicianId("T-1003"));
        using var response = await client.PostJsonAsync(BookingUrl(site), request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        var decision = booked.Allocation.ShouldNotBeNull();
        decision.PolicyVersion.ShouldBe(2);
        decision.MinimumHvLevel.ShouldBe(3);
        decision.PreferredTechnicianId.ShouldBe(request.PreferredTechnicianId);
        decision.Reasons.ShouldContain("preferred-technician:minimum-hv-level");
        booked.Technician.Id.ShouldBe(ReferenceDataSeed.TechnicianId("T-1002"));
        await _factory.WithDbAsync(async db =>
        {
            var versionTwo = await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site && r.PolicyVersion == 2).ToListAsync(Ct);
            db.RequirementRules.AddRange(versionTwo.Select(r => r with { Id = Guid.NewGuid(), PolicyVersion = 3,
                MinimumHvLevel = r.Code == "hv-routine" ? 4 : r.MinimumHvLevel }));
            await db.SaveChangesAsync(Ct);
        });
        using var detail = await client.GetAsync($"/api/v1/appointments/{booked.Id}", Ct);
        (await detail.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).Allocation.ShouldBe(decision);
    }

    [Fact]
    public async Task Profile_resolution_has_the_booking_rate_limit_and_documented_problem()
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "100").UseSetting("Security:RateLimiting:BookingPermitsPerMinute", "1"));
        using var client = host.CreateClient();
        using var first = await client.PostJsonAsync("/api/v1/vehicle-profiles/resolve", new ResolveVehicleProfileRequest(),
            SchedulerJsonContext.Default.ResolveVehicleProfileRequest, Ct);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var second = await client.PostJsonAsync("/api/v1/vehicle-profiles/resolve", new ResolveVehicleProfileRequest(),
            SchedulerJsonContext.Default.ResolveVehicleProfileRequest, Ct);
        second.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        second.Headers.RetryAfter.ShouldNotBeNull();
        using var problem = await second.ReadProblemAsync(Ct);
        problem.RootElement.GetProperty("type").GetString().ShouldEndWith("/rate-limited");
    }

    private static string BookingUrl(Guid site) => $"/api/v1/dealerships/{site}/appointments";
}

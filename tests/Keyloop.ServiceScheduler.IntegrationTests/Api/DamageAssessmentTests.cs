using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class DamageAssessmentTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData(false, false, false)]
    [InlineData(false, true, false)]
    [InlineData(true, false, false)]
    [InlineData(true, true, false)]
    [InlineData(false, false, true)]
    [InlineData(false, true, true)]
    [InlineData(true, false, true)]
    [InlineData(true, true, true)]
    public async Task Damage_assessment_is_bookable_at_both_seeded_sites_with_legacy_or_vehicle_aware_rules(bool enabled, bool unknown, bool munich)
    {
        var site = munich ? ReferenceDataSeed.MunichDealershipId : ReferenceDataSeed.ReadingDealershipId;
        var service = ReferenceDataSeed.ServiceTypeId("ACCIDENT-DAMAGE-ASSESSMENT");
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", enabled.ToString()));
        using var client = host.CreateClient();
        var query = enabled ? $"&powertrain={(unknown ? "Unknown" : "Ice")}" : "";
        using var availability = JsonDocument.Parse(await client.GetStringAsync(
            $"/api/v1/dealerships/{site}/availability?serviceTypeId={service}&date=2026-10-13{query}", Ct));
        availability.RootElement.GetProperty("slots").GetArrayLength().ShouldBeGreaterThan(0);
        var request = TestData.BookingRequest(service, TestData.LondonTime(10));
        // Flag-off deployments use service-type qualification and do not accept vehicle.profile.
        if (enabled && !unknown)
        {
            request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: "Verified at intake") } };
        }
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{site}/appointments", request,
            SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        booked.Technician.Id.ShouldBe(ReferenceDataSeed.TechnicianId(munich ? "M-2002" : "T-1005"));
        (booked.EndUtc - booked.StartUtc).TotalMinutes.ShouldBe(60);
        if (enabled)
        {
            var decision = booked.Allocation.ShouldNotBeNull();
            decision.PolicyVersion.ShouldBe(2);
            decision.MinimumHvLevel.ShouldBe(unknown ? 3 : 0);
            decision.FiredRules.ShouldBe(unknown ? ["hv-post-collision"] : []);
        }
        else
        {
            booked.Allocation.ShouldBeNull();
        }
    }

    [Fact]
    public async Task Startup_adds_missing_service_and_versions_the_latest_custom_policy_without_rewriting_resources_or_old_decisions()
    {
        var site = ReferenceDataSeed.ReadingDealershipId;
        await _factory.WithDbAsync(async db =>
        {
            await db.RequirementRules.ExecuteDeleteAsync(Ct);
            var old = RequirementRule.DefaultPolicy(site).Where(r => r.Code != RequirementRule.PostCollisionRuleCode)
                .Select(r => r with { Id = Guid.NewGuid(), PolicyVersion = 7, MinimumHvLevel = r.Code == "hv-routine" ? 3 : r.MinimumHvLevel });
            db.RequirementRules.AddRange(old);
            await db.SaveChangesAsync(Ct);
            await db.ServiceTypes.Where(s => s.Id == ReferenceDataSeed.ServiceTypeId("ACCIDENT-DAMAGE-ASSESSMENT")).ExecuteDeleteAsync(Ct);
            await db.Database.ExecuteSqlAsync($"UPDATE technicians SET certifications = array_remove(certifications, 'DamageAssessment')", Ct);
        });
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{site}/appointments",
            TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10)),
            SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var booked = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        booked.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(7);
        var originalRules = await _factory.WithDbAsync(db => db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site).OrderBy(r => r.Order).ToListAsync(Ct));
        var resourcesBefore = await ResourcesAsync();
        var logs = new CapturingLoggerProvider();
        var upgrade = await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        upgrade.RowsAdded.ShouldBe(15); // service + 7 Reading + 7 Munich
        upgrade.PublishedPolicies.ShouldBe([new(site, 8, 7), new(ReferenceDataSeed.MunichDealershipId, 2, 0)], ignoreOrder: true);
        var repeat = await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        (repeat.RowsAdded, repeat.PublishedPolicies.Count).ShouldBe((0, 0));
        // Logged by the caller after commit: one line per dealership that received a version, naming the previous latest one (0: Munich
        // had none after the delete above).
        upgrade.LogPublished(logs.CreateLogger("seed"));
        repeat.LogPublished(logs.CreateLogger("seed"));
        logs.Entries.Select(e => (e.EventId.Id, e.Message)).ShouldBe([
            (1107, $"Seeding published requirement policy version 8 for dealership {site}; previous latest version 7 (0: none)"),
            (1107, $"Seeding published requirement policy version 2 for dealership {ReferenceDataSeed.MunichDealershipId}; previous latest version 0 (0: none)"),
        ], ignoreOrder: true);
        (await ResourcesAsync()).ShouldBe(resourcesBefore);
        await _factory.WithDbAsync(async db =>
        {
            var archived = await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site && r.PolicyVersion == 7).OrderBy(r => r.Order).ToListAsync(Ct);
            archived.Select(r => (r.Id, r.MinimumHvLevel, r.Code)).ShouldBe(originalRules.Select(r => (r.Id, r.MinimumHvLevel, r.Code)));
            var latest = await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site && r.PolicyVersion == 8).ToListAsync(Ct);
            latest.Count.ShouldBe(7);
            latest.Single(r => r.Code == "hv-routine").MinimumHvLevel.ShouldBe(3);
            latest.Single(r => r.Code == "hv-post-collision").MinimumHvLevel.ShouldBe(3);
            latest.Single(r => r.Code == "hv-post-collision").ServiceCodes.ShouldBe(["ACCIDENT-DAMAGE-ASSESSMENT"]);
            var appointment = await db.Appointments.AsNoTracking().SingleAsync(a => a.Id == booked.Id, Ct);
            appointment.AllocationDecision.ShouldNotBeNull().PolicyVersion.ShouldBe(7);
            appointment.AllocationDecision.MinimumHvLevel.ShouldBe(3);
        });
        // The service exists but startup has not granted a new qualification to any person.
        using var gap = await client.PostJsonAsync($"/api/v1/dealerships/{site}/appointments",
            TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("ACCIDENT-DAMAGE-ASSESSMENT"), TestData.LondonTime(12)),
            SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        var problem = await gap.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct);
        problem.GetProperty("minimumHvLevel").GetInt32().ShouldBe(3);
        problem.GetProperty("missingCertifications").EnumerateArray().Select(c => c.GetString()).ShouldBe(["DamageAssessment"]);
    }

    [Fact]
    public async Task Startup_upgrade_is_one_shot_and_keeps_a_later_operator_version_without_the_collision_rule()
    {
        // The fresh seed is v2 with hv-post-collision. An operator then publishes v3 without it (Task 30 editing).
        var site = ReferenceDataSeed.ReadingDealershipId;
        await _factory.WithDbAsync(async db =>
        {
            db.RequirementRules.AddRange(RequirementRule.DefaultPolicy(site).Where(r => r.Code != RequirementRule.PostCollisionRuleCode)
                .Select(r => r with { Id = Guid.NewGuid(), PolicyVersion = 3 }));
            await db.SaveChangesAsync(Ct);
        });
        var result = await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        (result.RowsAdded, result.PublishedPolicies.Count).ShouldBe((0, 0));
        await _factory.WithDbAsync(async db =>
        {
            var latest = await db.RequirementRules.AsNoTracking().Where(r => r.DealershipId == site).MaxAsync(r => r.PolicyVersion, Ct);
            latest.ShouldBe(3);
            (await db.RequirementRules.AsNoTracking().CountAsync(r => r.DealershipId == site && r.PolicyVersion == 3, Ct)).ShouldBe(6);
        });
    }

    private Task<List<string>> ResourcesAsync() => _factory.WithDbAsync(db => db.Database.SqlQuery<string>($"""
        SELECT to_jsonb(t)::text AS "Value" FROM technicians t
        UNION ALL SELECT to_jsonb(b)::text AS "Value" FROM service_bays b ORDER BY "Value"
        """).ToListAsync(Ct));
}

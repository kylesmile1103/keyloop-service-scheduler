using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using System.Data.Common;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class AdminCompetenceWarningTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Guid Site => ReferenceDataSeed.ReadingDealershipId;
    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
    }
    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Older_booking_without_full_snapshot_uses_its_recorded_policy_after_a_new_version_removes_the_rule()
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var policyPath = $"/api/v1/dealerships/{Site}/requirement-policy";
        using var initial = await client.GetAsync(policyPath, Ct);
        var policy = JsonNode.Parse(await initial.Content.ReadAsStringAsync(Ct))!;
        policy["rules"]![1]!["certifications"] = new JsonArray("Brakes");
        policy["previewDate"] = "2026-10-13";
        policy["dryRun"] = false;
        using var v3 = await Put(policyPath, policy, initial.Headers.ETag!.ToString());
        v3.StatusCode.ShouldBe(HttpStatusCode.OK);
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10),
            preferredBayId: ReferenceDataSeed.BayId("reading", 1), preferredTechnicianId: ReferenceDataSeed.TechnicianId("T-1001"));
        using var booked = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        var appointment = await booked.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.Allocation.ShouldNotBeNull().PolicyVersion.ShouldBe(3);
        // Simulate an appointment written before the full snapshot column existed.
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE appointments SET recorded_requirements = NULL WHERE id = {appointment.Id}", Ct));
        policy["rules"] = new JsonArray();
        using var v4 = await Put(policyPath, policy, v3.Headers.ETag!.ToString());
        v4.StatusCode.ShouldBe(HttpStatusCode.OK);
        var technicianPath = $"/api/v1/dealerships/{Site}/technicians/{appointment.Technician.Id}";
        using var technician = await client.GetAsync(technicianPath, Ct);
        var resource = JsonNode.Parse(await technician.Content.ReadAsStringAsync(Ct))!;
        resource["certifications"] = new JsonArray("GeneralService", "MotTester");
        using var removed = await Put(technicianPath, resource, technician.Headers.ETag!.ToString());
        removed.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var details = await client.GetAsync($"/api/v1/appointments/{appointment.Id}", Ct);
        var state = JsonNode.Parse(await details.Content.ReadAsStringAsync(Ct))!;
        state["allocation"]!["policyVersion"]!.GetValue<int>().ShouldBe(3);
        state["competenceWarning"]!["reasonCodes"]!.AsArray().Select(v => v!.GetValue<string>()).ShouldBe(["technician-certification-removed"]);

        async Task<HttpResponseMessage> Put(string path, JsonNode body, string etag)
        {
            if (path == policyPath && !body["dryRun"]!.GetValue<bool>())
            {
                var preview = body.DeepClone();
                preview["dryRun"] = true;
                using var response = await Put(path, preview, etag);
                response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
                body["previewToken"] = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["previewToken"]!.GetValue<string>();
            }
            using var message = new HttpRequestMessage(HttpMethod.Put, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
            message.Headers.TryAddWithoutValidation("If-Match", etag);
            return await client.SendAsync(message, Ct);
        }
    }

    /// <summary>Reconstructs missing requirement snapshots once per recorded policy version during a board read.</summary>
    [Fact]
    public async Task Board_read_reconstructs_each_older_policy_version_once()
    {
        var rules = new RuleReads();
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, o) => o.AddInterceptors(rules))));
        using var client = host.CreateClient();
        foreach (var hour in new[] { 9, 11, 13 })
        {
            var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(hour), customerIndex: hour);
            using var created = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
            created.StatusCode.ShouldBe(HttpStatusCode.Created, await created.Content.ReadAsStringAsync(Ct));
        }
        // Simulate appointments written before the full snapshot column existed.
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE appointments SET recorded_requirements = NULL", Ct));
        Interlocked.Exchange(ref rules.Count, 0);
        using var schedule = await client.GetAsync($"/api/v1/dealerships/{Site}/schedule?date=2026-10-13", Ct);
        schedule.StatusCode.ShouldBe(HttpStatusCode.OK, await schedule.Content.ReadAsStringAsync(Ct));
        JsonNode.Parse(await schedule.Content.ReadAsStringAsync(Ct))!["bays"]!.AsArray().Sum(b => b!["appointments"]!.AsArray().Count).ShouldBe(3);
        rules.Count.ShouldBe(1);
    }

    private sealed class RuleReads : DbCommandInterceptor
    {
        public int Count;

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("FROM requirement_rules", StringComparison.Ordinal)) { Interlocked.Increment(ref Count); }
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>Flags competence warnings only on appointments that still hold bay and technician resources.</summary>
    [Fact]
    public async Task Only_appointments_that_still_hold_their_resources_are_flagged()
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var ids = new Dictionary<AppointmentStatus, Guid>();
        foreach (var (status, hour) in new[] { (AppointmentStatus.Cancelled, 9), (AppointmentStatus.Completed, 11), (AppointmentStatus.NoShow, 13),
            (AppointmentStatus.InProgress, 15), (AppointmentStatus.Confirmed, 16) })
        {
            var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(hour), customerIndex: hour,
                preferredBayId: ReferenceDataSeed.BayId("reading", 1), preferredTechnicianId: ReferenceDataSeed.TechnicianId("T-1001"));
            using var created = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
            created.StatusCode.ShouldBe(HttpStatusCode.Created, await created.Content.ReadAsStringAsync(Ct));
            ids[status] = (await created.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).Id;
        }
        using (var cancelled = await client.PostJsonAsync($"/api/v1/appointments/{ids[AppointmentStatus.Cancelled]}/cancel",
            new CancelAppointmentRequest("Customer called to reschedule."), SchedulerJsonContext.Default.CancelAppointmentRequest, Ct))
        {
            cancelled.StatusCode.ShouldBe(HttpStatusCode.OK, await cancelled.Content.ReadAsStringAsync(Ct));
        }
        _factory.Clock.SetUtcNow(new DateTimeOffset(2026, 10, 14, 8, 0, 0, TimeSpan.Zero));
        await _factory.WithDbAsync(async db =>
        {
            var now = _factory.Clock.GetUtcNow().UtcDateTime;
            var appointments = await db.Appointments.Where(a => ids.Values.Contains(a.Id)).ToDictionaryAsync(a => a.Id, Ct);
            var completed = appointments[ids[AppointmentStatus.Completed]];
            completed.CheckIn(now);
            completed.Start(now);
            completed.Complete(now);
            appointments[ids[AppointmentStatus.NoShow]].MarkNoShow(now);
            var started = appointments[ids[AppointmentStatus.InProgress]];
            started.CheckIn(now);
            started.Start(now);
            await db.SaveChangesAsync(Ct);
        });
        var technicianPath = $"/api/v1/dealerships/{Site}/technicians/{ReferenceDataSeed.TechnicianId("T-1001")}";
        using var technician = await client.GetAsync(technicianPath, Ct);
        var resource = JsonNode.Parse(await technician.Content.ReadAsStringAsync(Ct))!;
        resource["isActive"] = false;
        using var message = new HttpRequestMessage(HttpMethod.Put, technicianPath) { Content = new StringContent(resource.ToJsonString(), Encoding.UTF8, "application/json") };
        message.Headers.TryAddWithoutValidation("If-Match", technician.Headers.ETag!.ToString());
        using var deactivated = await client.SendAsync(message, Ct);
        deactivated.StatusCode.ShouldBe(HttpStatusCode.OK, await deactivated.Content.ReadAsStringAsync(Ct));

        foreach (var (status, id) in ids)
        {
            using var details = await client.GetAsync($"/api/v1/appointments/{id}", Ct);
            var detail = JsonNode.Parse(await details.Content.ReadAsStringAsync(Ct))!;
            detail["status"]!.GetValue<string>().ShouldBe(status.ToString());
            var flagged = status is AppointmentStatus.Confirmed or AppointmentStatus.InProgress;
            (detail["competenceWarning"] is not null).ShouldBe(flagged, status.ToString());
        }
        using var schedule = await client.GetAsync($"/api/v1/dealerships/{Site}/schedule?date=2026-10-13", Ct);
        var rows = JsonNode.Parse(await schedule.Content.ReadAsStringAsync(Ct))!["bays"]!.AsArray().SelectMany(b => b!["appointments"]!.AsArray()).ToList();
        rows.Count.ShouldBe(4, "the board omits only the cancelled appointment");
        foreach (var row in rows)
        {
            var status = Enum.Parse<AppointmentStatus>(row!["status"]!.GetValue<string>());
            (row["competenceWarning"] is not null).ShouldBe(status is AppointmentStatus.Confirmed or AppointmentStatus.InProgress, status.ToString());
        }
    }

    [Theory]
    [InlineData("expiry", "technician-hv-expired")]
    [InlineData("level", "technician-hv-level-lowered")]
    [InlineData("certification", "technician-certification-removed")]
    [InlineData("technician", "technician-inactive")]
    [InlineData("bay", "bay-inactive")]
    [InlineData("capability", "bay-capability-removed")]
    public async Task Read_flags_recorded_requirement_lapse_without_rewriting_appointment(string edit, string reason)
    {
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        using var client = host.CreateClient();
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(10),
            preferredBayId: ReferenceDataSeed.BayId("reading", 1), preferredTechnicianId: ReferenceDataSeed.TechnicianId("T-1001"));
        using var created = await client.PostJsonAsync($"/api/v1/dealerships/{Site}/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var appointment = await created.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        var initialVersion = await _factory.WithDbAsync(db => db.Appointments.Where(a => a.Id == appointment.Id).Select(a => a.RowVersion).SingleAsync(Ct));
        var resource = edit is "bay" or "capability" ? $"bays/{appointment.Bay.Id}" : $"technicians/{appointment.Technician.Id}";
        var path = $"/api/v1/dealerships/{Site}/{resource}";
        using var read = await client.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        switch (edit)
        {
            case "expiry": body["hvLevelValidUntil"] = "2026-10-12"; break;
            case "level": body["hvLevel"] = 1; break;
            case "certification": body["certifications"] = new JsonArray(); break;
            case "technician": case "bay": body["isActive"] = false; break;
            case "capability": body["capabilities"] = new JsonArray(); break;
        }
        using var message = new HttpRequestMessage(HttpMethod.Put, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        message.Headers.TryAddWithoutValidation("If-Match", read.Headers.ETag!.ToString());
        using var updated = await client.SendAsync(message, Ct);
        updated.StatusCode.ShouldBe(HttpStatusCode.OK, await updated.Content.ReadAsStringAsync(Ct));
        using var details = await client.GetAsync($"/api/v1/appointments/{appointment.Id}", Ct);
        var detail = JsonNode.Parse(await details.Content.ReadAsStringAsync(Ct))!;
        detail["competenceWarning"]!["reasonCodes"]!.AsArray().Select(r => r!.GetValue<string>()).ShouldBe([reason]);
        detail["competenceWarning"]!["requiresReview"]!.GetValue<bool>().ShouldBeTrue();
        foreach (var role in new[] { "Admin", "ServiceAdvisor", "Viewer", "Unknown", "Anonymous" })
        {
            client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
            client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
            using var schedule = await client.GetAsync($"/api/v1/dealerships/{Site}/schedule?date=2026-10-13", Ct);
            var raw = await schedule.Content.ReadAsStringAsync(Ct);
            var row = JsonNode.Parse(raw)!["bays"]!.AsArray().SelectMany(b => b!["appointments"]!.AsArray()).Single();
            if (role is "Unknown" or "Anonymous")
            {
                row!["competenceWarning"].ShouldBeNull();
                raw.ShouldNotContain("Customer 1");
                raw.ShouldNotContain(request.Vehicle.Vin);
                raw.ShouldNotContain("AB12 CDE");
            }
            else { row!["competenceWarning"]!["reasonCodes"]![0]!.GetValue<string>().ShouldBe(reason); }
        }
        using var off = _factory.CreateClient();
        using var hidden = await off.GetAsync($"/api/v1/appointments/{appointment.Id}", Ct);
        JsonNode.Parse(await hidden.Content.ReadAsStringAsync(Ct))!["competenceWarning"].ShouldBeNull();
        (await _factory.WithDbAsync(db => db.Appointments.Where(a => a.Id == appointment.Id).Select(a => a.RowVersion).SingleAsync(Ct))).ShouldBe(initialVersion);
    }
}

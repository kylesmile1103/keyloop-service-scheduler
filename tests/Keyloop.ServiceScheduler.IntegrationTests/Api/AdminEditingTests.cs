using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class AdminEditingTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private WebApplicationFactory<Program> _host = null!;
    private HttpClient _client = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Site => $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}";
    private static string Technician => Site + $"/technicians/{ReferenceDataSeed.TechnicianId("T-1001")}";
    private static string Bay => Site + $"/bays/{ReferenceDataSeed.BayId("reading", 1)}";

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        _host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        _client = _host.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _host.DisposeAsync();
        await _factory.DisposeAsync();
    }

    [Theory]
    [InlineData("Anonymous", 401)]
    [InlineData("Unknown", 403)]
    [InlineData("Viewer", 403)]
    [InlineData("ServiceAdvisor", 403)]
    public async Task Every_admin_route_denies_callers_without_Admin(string role, int status)
    {
        _client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        _client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        foreach (var (method, path) in new (HttpMethod, string)[]
        {
            (HttpMethod.Get, Site + "/technicians"), (HttpMethod.Get, Technician),
            (HttpMethod.Post, Site + "/technicians"), (HttpMethod.Put, Technician),
            (HttpMethod.Post, Technician + "/confirm-hv-level"),
            (HttpMethod.Get, Site + "/bays"), (HttpMethod.Get, Bay),
            (HttpMethod.Post, Site + "/bays"), (HttpMethod.Put, Bay),
            (HttpMethod.Get, Site + "/requirement-policy"), (HttpMethod.Put, Site + "/requirement-policy"),
            (HttpMethod.Get, Site + "/admin-history"),
        })
        {
            using var response = await Send(method, path, "{}");
            ((int)response.StatusCode).ShouldBe(status, method + " " + path);
            using var problem = await response.ReadProblemAsync(Ct);
            problem.RootElement.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        }
    }

    [Theory]
    [InlineData("technician")]
    [InlineData("bay")]
    public async Task Requires_If_Match_and_returns_current_state_on_stale_edit(string kind)
    {
        var path = kind == "technician" ? Technician : Bay;
        using var read = await _client.GetAsync(path, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var etag = read.Headers.ETag.ShouldNotBeNull().ToString();
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["name"] = "Updated resource";
        using var missing = await Send(HttpMethod.Put, path, body.ToJsonString());
        ((int)missing.StatusCode).ShouldBe(428);
        using var saved = await Send(HttpMethod.Put, path, body.ToJsonString(), etag);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
        saved.Headers.ETag.ShouldNotBeNull().ToString().ShouldNotBe(etag);
        body["name"] = "Losing update";
        using var stale = await Send(HttpMethod.Put, path, body.ToJsonString(), etag);
        stale.StatusCode.ShouldBe(HttpStatusCode.PreconditionFailed);
        var problem = JsonNode.Parse(await stale.Content.ReadAsStringAsync(Ct))!;
        problem["current"]!["name"]!.GetValue<string>().ShouldBe("Updated resource");
        problem["currentETag"]!.GetValue<string>().ShouldBe(saved.Headers.ETag!.ToString());
        stale.Headers.ETag!.ToString().ShouldBe(saved.Headers.ETag!.ToString());
    }

    [Fact]
    public async Task Dry_run_does_not_publish_and_save_creates_next_policy_version()
    {
        using var read = await _client.GetAsync(Site + "/requirement-policy", Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["rules"]![1]!["minimumHvLevel"] = 4;
        body["dryRun"] = true;
        body["previewDate"] = "2026-10-13";
        body["dryRun"] ??= JsonValue.Create(false);
        using var preview = await Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString(), read.Headers.ETag!.ToString());
        preview.StatusCode.ShouldBe(HttpStatusCode.OK, await preview.Content.ReadAsStringAsync(Ct));
        var previewBody = JsonNode.Parse(await preview.Content.ReadAsStringAsync(Ct))!;
        previewBody["saved"]!.GetValue<bool>().ShouldBeFalse();
        previewBody["changes"]!.AsArray().ShouldNotBeEmpty();
        using var unchanged = await _client.GetAsync(Site + "/requirement-policy", Ct);
        unchanged.Headers.ETag!.ToString().ShouldBe(read.Headers.ETag!.ToString());
        body["dryRun"] = false;
        body["previewToken"] = previewBody["previewToken"]!.GetValue<string>();
        using var save = await Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString(), read.Headers.ETag!.ToString());
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync(Ct));
        var saved = JsonNode.Parse(await save.Content.ReadAsStringAsync(Ct))!;
        saved["saved"]!.GetValue<bool>().ShouldBeTrue();
        saved["policy"]!["version"]!.GetValue<int>().ShouldBe(3);
        using var stale = await Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString(), read.Headers.ETag!.ToString());
        stale.StatusCode.ShouldBe(HttpStatusCode.PreconditionFailed);
    }

    [Fact]
    public async Task Deactivation_and_confirmation_have_bounded_before_and_after_audit()
    {
        using var read = await _client.GetAsync(Technician, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["isActive"] = false;
        body["hvLevelConfirmed"] = false;
        using var edit = await Send(HttpMethod.Put, Technician, body.ToJsonString(), read.Headers.ETag!.ToString());
        edit.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var confirm = await Send(HttpMethod.Post, Technician + "/confirm-hv-level", null, edit.Headers.ETag!.ToString());
        confirm.StatusCode.ShouldBe(HttpStatusCode.OK, await confirm.Content.ReadAsStringAsync(Ct));
        using var history = await _client.GetAsync(Site + "/admin-history", Ct);
        history.StatusCode.ShouldBe(HttpStatusCode.OK);
        var rows = JsonNode.Parse(await history.Content.ReadAsStringAsync(Ct))!["items"]!.AsArray();
        rows.Count.ShouldBe(2);
        var confirmed = rows.Single(r => r!["action"]!.GetValue<string>() == "confirm-hv")!;
        var deactivated = rows.Single(r => r!["action"]!.GetValue<string>() == "deactivate")!;
        confirmed["actor"]!.GetValue<string>().ShouldBe("user:test-user@keyloop.test");
        confirmed["after"]!["hvLevelConfirmed"]!.GetValue<bool>().ShouldBeTrue();
        deactivated["before"]!["isActive"]!.GetValue<bool>().ShouldBeTrue();
        deactivated["after"]!["isActive"]!.GetValue<bool>().ShouldBeFalse();
    }

    [Theory]
    [InlineData("technician")]
    [InlineData("bay")]
    public async Task Simultaneous_edits_have_one_winner_and_one_audited_change(string kind)
    {
        var path = kind == "technician" ? Technician : Bay;
        using var read = await _client.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["name"] = "Parallel edit";
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Send(HttpMethod.Put, path, body.ToJsonString(), read.Headers.ETag!.ToString())));
        try
        {
            responses.Count(r => r.StatusCode == HttpStatusCode.OK).ShouldBe(1);
            responses.Count(r => r.StatusCode == HttpStatusCode.PreconditionFailed).ShouldBe(1);
            using var history = await _client.GetAsync(Site + "/admin-history", Ct);
            JsonNode.Parse(await history.Content.ReadAsStringAsync(Ct))!["items"]!.AsArray().Count.ShouldBe(1);
        }
        finally { foreach (var response in responses) { response.Dispose(); } }
    }

    /// <summary>
    /// An out-of-band writer commits between an Admin edit's If-Match check and its UPDATE. Ordinary Admin writes now serialize under
    /// the dealership lock and cannot interleave there. The xmin-conditional update still protects against bypass writers, producing
    /// 412 with the current state and ETag and rolling back the Admin audit.
    /// </summary>
    [Theory]
    [InlineData("technician")]
    [InlineData("bay")]
    public async Task Edit_that_loses_after_its_If_Match_check_is_refused_by_the_conditional_update(string kind)
    {
        var path = kind == "technician" ? Technician : Bay;
        using var read = await _client.GetAsync(path, Ct);
        var etag = read.Headers.ETag!.ToString();
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        HttpClient client = null!;
        HttpResponseMessage? winner = null;
        var race = new BeforeResourceUpdate(kind == "technician" ? "technicians" : "service_bays", async ct =>
        {
            var id = body["id"]!.GetValue<Guid>();
            await _factory.WithDbAsync(async db =>
            {
                if (kind == "technician")
                {
                    await db.Technicians.Where(t => t.Id == id).ExecuteUpdateAsync(setters => setters.SetProperty(t => t.Name, "Winning edit"), ct);
                }
                else
                {
                    await db.ServiceBays.Where(b => b.Id == id).ExecuteUpdateAsync(setters => setters.SetProperty(b => b.Name, "Winning edit"), ct);
                }
            });
            winner = await client.GetAsync(path, ct);
        });
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, options) => options.AddInterceptors(race))));
        client = host.CreateClient();
        try
        {
            body["name"] = "Losing edit";
            race.Arm();
            using var loser = await SendAsync(client, HttpMethod.Put, path, body.ToJsonString(), etag, Ct);
            race.Fired.ShouldBe(1);
            winner.ShouldNotBeNull().StatusCode.ShouldBe(HttpStatusCode.OK, await winner.Content.ReadAsStringAsync(Ct));
            var winnerTag = winner.Headers.ETag.ShouldNotBeNull().ToString();
            loser.StatusCode.ShouldBe(HttpStatusCode.PreconditionFailed, await loser.Content.ReadAsStringAsync(Ct));
            var problem = JsonNode.Parse(await loser.Content.ReadAsStringAsync(Ct))!;
            problem["type"]!.GetValue<string>().ShouldEndWith("/precondition-failed");
            problem["current"]!["name"]!.GetValue<string>().ShouldBe("Winning edit");
            problem["currentETag"]!.GetValue<string>().ShouldBe(winnerTag);
            loser.Headers.ETag.ShouldNotBeNull().ToString().ShouldBe(winnerTag);
            var changes = await _factory.WithDbAsync(db => db.AdminChanges.AsNoTracking().ToListAsync(Ct));
            changes.ShouldBeEmpty("the bypass writer has no Admin audit, and the rejected Admin write rolled its audit back");
        }
        finally
        {
            winner?.Dispose();
            client.Dispose();
        }
    }

    [Theory]
    [InlineData("technician")]
    [InlineData("bay")]
    public async Task Create_and_reactivate_preserve_history_and_advance_ETag(string kind)
    {
        var suffix = kind == "technician" ? "/technicians" : "/bays";
        var body = kind == "technician"
            ? "{\"name\":\"New technician\",\"employeeNumber\":\"N-001\",\"certifications\":[],\"isActive\":false,\"hvLevel\":3,\"hvLevelValidUntil\":null,\"hvLevelConfirmed\":false,\"brandSpecialisms\":[\"bmw\"]}"
            : "{\"name\":\"New bay\",\"capabilities\":[],\"isActive\":false}";
        using var created = await Send(HttpMethod.Post, Site + suffix, body);
        created.StatusCode.ShouldBe(HttpStatusCode.Created, await created.Content.ReadAsStringAsync(Ct));
        var path = created.Headers.Location!.ToString();
        var state = JsonNode.Parse(await created.Content.ReadAsStringAsync(Ct))!;
        if (kind == "technician") { state["brandSpecialisms"]![0]!.GetValue<string>().ShouldBe("BMW"); }
        state["isActive"] = true;
        using var active = await Send(HttpMethod.Put, path, state.ToJsonString(), created.Headers.ETag!.ToString());
        active.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var read = await _client.GetAsync(path, Ct);
        read.Headers.ETag!.ToString().ShouldBe(active.Headers.ETag!.ToString());
        using var history = await _client.GetAsync(Site + "/admin-history?resourceId=" + state["id"]!.GetValue<string>(), Ct);
        var rows = JsonNode.Parse(await history.Content.ReadAsStringAsync(Ct))!["items"]!.AsArray();
        rows.Count.ShouldBe(2);
        rows.Single(r => r!["action"]!.GetValue<string>() == "reactivate")!["before"]!["isActive"]!.GetValue<bool>().ShouldBeFalse();
        rows.Single(r => r!["action"]!.GetValue<string>() == "create")!["before"].ShouldBeNull();
    }

    [Fact]
    public async Task Duplicate_employee_number_has_field_error_and_no_orphan_audit()
    {
        using var read = await _client.GetAsync(Technician, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["employeeNumber"] = "T-1002";
        using var duplicate = await Send(HttpMethod.Put, Technician, body.ToJsonString(), read.Headers.ETag!.ToString());
        duplicate.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        JsonNode.Parse(await duplicate.Content.ReadAsStringAsync(Ct))!["errors"]!["employeeNumber"].ShouldNotBeNull();
        using var history = await _client.GetAsync(Site + "/admin-history", Ct);
        JsonNode.Parse(await history.Content.ReadAsStringAsync(Ct))!["items"]!.AsArray().ShouldBeEmpty();
    }

    [Fact]
    public async Task Empty_policy_is_versioned_and_startup_does_not_restore_removed_rules()
    {
        using var read = await _client.GetAsync(Site + "/requirement-policy", Ct);
        var publication = JsonNode.Parse("{\"rules\":[],\"dryRun\":false,\"previewDate\":\"2026-10-13\"}")!;
        await ConfirmPreviewAsync(_client, publication, read.Headers.ETag!.ToString());
        using var saved = await Send(HttpMethod.Put, Site + "/requirement-policy", publication.ToJsonString(), read.Headers.ETag!.ToString());
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        using var current = await _client.GetAsync(Site + "/requirement-policy", Ct);
        var body = JsonNode.Parse(await current.Content.ReadAsStringAsync(Ct))!;
        body["version"]!.GetValue<int>().ShouldBe(3);
        body["rules"]!.AsArray().ShouldBeEmpty();
        using var availability = await _client.GetAsync(Site + $"/availability?serviceTypeId={ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE")}&date=2026-10-13", Ct);
        availability.StatusCode.ShouldBe(HttpStatusCode.OK, await availability.Content.ReadAsStringAsync(Ct));
    }

    [Theory]
    [InlineData("hvLevel", "5")]
    [InlineData("name", "\"\"")]
    [InlineData("brandSpecialisms", "[\"bad code!\"]")]
    [InlineData("certifications", "[999]")]
    [InlineData("certifications", "[0]")]
    public async Task Invalid_resource_fields_return_field_errors(string field, string value)
    {
        using var read = await _client.GetAsync(Technician, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body[field] = JsonNode.Parse(value);
        using var response = await Send(HttpMethod.Put, Technician, body.ToJsonString(), read.Headers.ETag!.ToString());
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await response.Content.ReadAsStringAsync(Ct));
        JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject().ShouldNotBeEmpty();
    }

    [Theory]
    [InlineData("minimumHvLevel", "5")]
    [InlineData("serviceCodes", "[\"NO-SUCH-SERVICE\"]")]
    [InlineData("condition", "\"Expression\"")]
    [InlineData("powertrains", "null")]
    [InlineData("powertrains", "[0]")]
    [InlineData("expression", "\"true\"")]
    public async Task Invalid_policy_vocabulary_and_service_references_return_field_errors(string field, string value)
    {
        using var read = await _client.GetAsync(Site + "/requirement-policy", Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["rules"]![0]![field] = JsonNode.Parse(value);
        body["previewDate"] = "2026-10-13";
        body["dryRun"] = true;
        using var response = await Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString(), read.Headers.ETag!.ToString());
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await response.Content.ReadAsStringAsync(Ct));
        JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"].ShouldNotBeNull();
    }

    [Fact]
    public async Task Concurrent_policy_publications_are_atomic_and_have_exactly_one_next_version()
    {
        using var read = await _client.GetAsync(Site + "/requirement-policy", Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["previewDate"] = "2026-10-13";
        body["dryRun"] ??= JsonValue.Create(false);
        await ConfirmPreviewAsync(_client, body, read.Headers.ETag!.ToString());
        using var missing = await Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString());
        ((int)missing.StatusCode).ShouldBe(428);
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Send(HttpMethod.Put, Site + "/requirement-policy", body.ToJsonString(), read.Headers.ETag!.ToString())));
        try
        {
            responses.Count(r => r.StatusCode == HttpStatusCode.OK).ShouldBe(1);
            responses.Count(r => r.StatusCode == HttpStatusCode.PreconditionFailed).ShouldBe(1);
            await _factory.WithDbAsync(async db =>
            {
                (await db.RequirementRules.CountAsync(r => r.DealershipId == ReferenceDataSeed.ReadingDealershipId && r.PolicyVersion == 2, Ct)).ShouldBe(7);
                (await db.RequirementRules.CountAsync(r => r.DealershipId == ReferenceDataSeed.ReadingDealershipId && r.PolicyVersion == 3, Ct)).ShouldBe(7);
                (await db.RequirementPolicyVersions.CountAsync(Ct)).ShouldBe(1);
                (await db.AdminChanges.CountAsync(Ct)).ShouldBe(1);
            });
        }
        finally { foreach (var response in responses) { response.Dispose(); } }
    }

    [Fact]
    public async Task Confirmation_requires_If_Match_and_stale_confirmation_cannot_overwrite_a_correction()
    {
        using var read = await _client.GetAsync(Technician, Ct);
        using var missing = await Send(HttpMethod.Post, Technician + "/confirm-hv-level", null);
        ((int)missing.StatusCode).ShouldBe(428);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["hvLevel"] = 1;
        body["hvLevelConfirmed"] = false;
        using var changed = await Send(HttpMethod.Put, Technician, body.ToJsonString(), read.Headers.ETag!.ToString());
        changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var stale = await Send(HttpMethod.Post, Technician + "/confirm-hv-level", null, read.Headers.ETag!.ToString());
        stale.StatusCode.ShouldBe(HttpStatusCode.PreconditionFailed);
        var current = JsonNode.Parse(await stale.Content.ReadAsStringAsync(Ct))!["current"]!;
        current["hvLevel"]!.GetValue<int>().ShouldBe(1);
        current["hvLevelConfirmed"]!.GetValue<bool>().ShouldBeFalse();
    }

    [Theory]
    [InlineData("technician", false)]
    [InlineData("technician", true)]
    [InlineData("bay", false)]
    [InlineData("bay", true)]
    [InlineData("policy", false)]
    [InlineData("policy", true)]
    public async Task Commit_retry_never_duplicates_an_edit_or_audit(string kind, bool beforeCommit)
    {
        var fault = new CommitAcknowledgementLoss { BeforeCommit = beforeCommit };
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, options) => options.AddInterceptors(fault))));
        using var client = host.CreateClient();
        var path = kind == "policy" ? Site + "/requirement-policy" : kind == "technician" ? Technician : Bay;
        using var read = await client.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        if (kind == "policy")
        {
            body["previewDate"] = "2026-10-13";
            body["dryRun"] = false;
            body["rules"]![0]!["minimumHvLevel"] = 3;
            await ConfirmPreviewAsync(client, body, read.Headers.ETag!.ToString());
        }
        else { body["name"] = "Retry resource"; }
        fault.Arm();
        using var message = new HttpRequestMessage(HttpMethod.Put, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        message.Headers.TryAddWithoutValidation("If-Match", read.Headers.ETag!.ToString());
        using var saved = await client.SendAsync(message, Ct);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
        fault.Fired.ShouldBe(1);
        if (kind == "policy")
        {
            JsonNode.Parse(await saved.Content.ReadAsStringAsync(Ct))!["changes"]!.AsArray().ShouldNotBeEmpty();
        }
        (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(1);
        using var current = await client.GetAsync(path, Ct);
        current.Headers.ETag!.ToString().ShouldBe(saved.Headers.ETag!.ToString());
    }

    [Fact]
    public async Task History_filters_and_pagination_preserve_bounded_snapshots()
    {
        using var read = await _client.GetAsync(Bay, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body["name"] = "First edit";
        using var first = await Send(HttpMethod.Put, Bay, body.ToJsonString(), read.Headers.ETag!.ToString());
        _factory.Clock.Advance(TimeSpan.FromSeconds(1));
        body["name"] = "Second edit";
        using var second = await Send(HttpMethod.Put, Bay, body.ToJsonString(), first.Headers.ETag!.ToString());
        using var page1 = await _client.GetAsync(Site + "/admin-history?resourceKind=bay&limit=1", Ct);
        var page = JsonNode.Parse(await page1.Content.ReadAsStringAsync(Ct))!;
        page["items"]![0]!["after"]!["name"]!.GetValue<string>().ShouldBe("Second edit");
        page["nextOffset"]!.GetValue<int>().ShouldBe(1);
        using var page2 = await _client.GetAsync(Site + "/admin-history?resourceKind=bay&limit=1&offset=1", Ct);
        JsonNode.Parse(await page2.Content.ReadAsStringAsync(Ct))!["items"]![0]!["after"]!["name"]!.GetValue<string>().ShouldBe("First edit");
        using var invalid = await _client.GetAsync(Site + "/admin-history?limit=101", Ct);
        invalid.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("technician", "TechnicianWriteRequest", "/technicians")]
    [InlineData("bay", "BayWriteRequest", "/bays")]
    [InlineData("policy", "PolicyWriteRequest", "/requirement-policy")]
    public async Task Contract_examples_are_complete_requests_that_the_API_accepts(string kind, string schema, string suffix)
    {
        var contract = JsonNode.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct))!;
        var example = contract["components"]!["schemas"]![schema]!["examples"]![0]!.ToJsonString();
        string? etag = null;
        if (kind == "policy")
        {
            using var read = await _client.GetAsync(Site + suffix, Ct);
            etag = read.Headers.ETag!.ToString();
        }
        using var response = await Send(kind == "policy" ? HttpMethod.Put : HttpMethod.Post, Site + suffix, example, etag);
        response.StatusCode.ShouldBe(kind == "policy" ? HttpStatusCode.OK : HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        if (kind == "policy") { JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["saved"]!.GetValue<bool>().ShouldBeFalse(); }
    }

    /// <summary>
    /// A field the contract marks required must be sent, even where null is a valid value: a client that leaves out
    /// <c>hvLevelValidUntil</c> must not silently make an expired HV level unlimited (and so qualify the technician again).
    /// </summary>
    [Theory]
    [InlineData("technician", "isActive")]
    [InlineData("technician", "hvLevelValidUntil")]
    [InlineData("bay", "isActive")]
    [InlineData("policy", "dryRun")]
    [InlineData("policy", "vehicleClass")]
    public async Task Missing_write_mode_fields_cannot_silently_deactivate_or_publish(string kind, string field)
    {
        var path = kind == "policy" ? Site + "/requirement-policy" : kind == "technician" ? Technician : Bay;
        using var read = await _client.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!.AsObject();
        if (kind == "policy")
        {
            // The read has no dryRun; the vehicleClass case is otherwise a complete save of the current rules.
            body["previewDate"] = "2026-10-13";
            if (field == "vehicleClass")
            {
                body["dryRun"] = false;
                body["rules"]![0]!.AsObject().Remove("vehicleClass").ShouldBeTrue();
            }
        }
        else { body.Remove(field).ShouldBeTrue(); }
        using var response = await Send(HttpMethod.Put, path, body.ToJsonString(), read.Headers.ETag!.ToString());
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await response.Content.ReadAsStringAsync(Ct));
        using var current = await _client.GetAsync(path, Ct);
        current.Headers.ETag!.ToString().ShouldBe(read.Headers.ETag!.ToString());
        (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(0);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, string? json, string? etag, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (json is not null) { request.Content = new StringContent(json, Encoding.UTF8, "application/json"); }
        if (etag is not null) { request.Headers.TryAddWithoutValidation("If-Match", etag); }
        return await client.SendAsync(request, ct);
    }

    private static async Task ConfirmPreviewAsync(HttpClient client, JsonNode body, string etag)
    {
        var preview = body.DeepClone();
        preview["dryRun"] = true;
        using var response = await SendAsync(client, HttpMethod.Put, Site + "/requirement-policy", preview.ToJsonString(), etag, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        body["previewToken"] = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["previewToken"]!.GetValue<string>();
    }

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string? json, string? etag = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (json is not null) { request.Content = new StringContent(json, Encoding.UTF8, "application/json"); }
        if (etag is not null) { request.Headers.TryAddWithoutValidation("If-Match", etag); }
        return await _client.SendAsync(request, Ct);
    }
}

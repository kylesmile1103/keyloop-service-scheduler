using System.Data.Common;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class PolicyPreviewTokenTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private WebApplicationFactory<Program> _host = null!;
    private HttpClient _client = null!;
    private JsonNode _publication = null!;
    private string _currentPolicy = null!;
    private string _etag = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Site => $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}";
    private static string PolicyPath => Site + "/requirement-policy";
    private static string TechnicianPath => Site + $"/technicians/{ReferenceDataSeed.TechnicianId("T-1005")}";

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        _host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        _client = _host.CreateClient();
        using var read = await _client.GetAsync(PolicyPath, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        _etag = read.Headers.ETag!.ToString();
        _publication = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        _currentPolicy = _publication.ToJsonString();
        _publication["rules"]![1]!["minimumHvLevel"] = 4;
        _publication["dryRun"] = false;
        _publication["previewDate"] = "2026-10-13";
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _host.DisposeAsync();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Dry_run_without_a_token_returns_a_deterministic_token_bound_to_the_date_and_rules()
    {
        var preview = await PreviewAsync();
        var token = preview["previewToken"]!.GetValue<string>();
        token.Length.ShouldBe(43);
        token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_').ShouldBeTrue();
        (await PreviewAsync())["previewToken"]!.GetValue<string>().ShouldBe(token);
        _publication["previewToken"] = "ignored for a dry run";
        (await PreviewAsync())["previewToken"]!.GetValue<string>().ShouldBe(token);
        _publication["previewDate"] = "2026-10-14";
        (await PreviewAsync())["previewToken"]!.GetValue<string>().ShouldNotBe(token);
        _publication["previewDate"] = "2026-10-13";
        _publication["rules"]![1]!["minimumHvLevel"] = 3;
        (await PreviewAsync())["previewToken"]!.GetValue<string>().ShouldNotBe(token);
        (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task Publish_with_the_confirmed_token_saves_the_next_version_and_audit_and_returns_the_same_token()
    {
        using var metrics = new MetricsCollector();
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        using var saved = await PutAsync(_client, _publication);
        await AssertSavedAsync(saved, preview);
        metrics.Sum("scheduler.admin.edits").ShouldBe(1);
    }

    [Fact]
    public async Task Technician_edit_changing_bookability_refuses_publication_without_writes_and_a_fresh_preview_can_publish()
    {
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        await EditTechnicianAsync("hvLevel", JsonValue.Create(4)!);
        var before = await StoredStateAsync();
        using var metrics = new MetricsCollector();
        using var refused = await PutAsync(_client, _publication);
        var problem = await refused.ShouldBeProblemAsync(HttpStatusCode.Conflict, "policy-preview-outdated", Ct);
        problem.GetProperty("title").GetString().ShouldBe("The preview is out of date");
        problem.GetProperty("detail").GetString().ShouldNotBeNull().ShouldContain("Run the preview again");
        problem.EnumerateObject().Select(p => p.Name).Order().ShouldBe(new[] { "type", "title", "status", "detail", "instance", "traceId" }.Order());
        (await StoredStateAsync()).ShouldBe(before);
        metrics.Sum("scheduler.admin.edits").ShouldBe(0);
        using var current = await _client.GetAsync(PolicyPath, Ct);
        current.Headers.ETag!.ToString().ShouldBe(_etag);
        JsonNode.Parse(await current.Content.ReadAsStringAsync(Ct))!.ToJsonString().ShouldBe(_currentPolicy);
        var fresh = await PreviewAsync();
        fresh["previewToken"]!.GetValue<string>().ShouldNotBe(preview["previewToken"]!.GetValue<string>());
        fresh["changes"]!.AsArray().Count.ShouldBeLessThan(preview["changes"]!.AsArray().Count);
        _publication["previewToken"] = fresh["previewToken"]!.GetValue<string>();
        using var saved = await PutAsync(_client, _publication);
        await AssertSavedAsync(saved, fresh, auditCount: 2);
        metrics.Sum("scheduler.admin.edits").ShouldBe(1);
    }

    [Fact]
    public async Task Technician_edit_leaving_bookability_unchanged_accepts_the_original_token()
    {
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        await EditTechnicianAsync("name", JsonValue.Create("Eva renamed")!);
        (await PreviewAsync())["previewToken"]!.GetValue<string>().ShouldBe(preview["previewToken"]!.GetValue<string>());
        using var saved = await PutAsync(_client, _publication);
        await AssertSavedAsync(saved, preview, auditCount: 2);
    }

    [Fact]
    public async Task Publication_reads_roster_consequences_after_waiting_for_its_existing_dealership_lock()
    {
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        await using var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var transaction = await connection.BeginTransactionAsync(Ct);
        await using (var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, transaction))
        {
            command.Parameters.AddWithValue("key", DealershipLock.KeyFor(ReferenceDataSeed.ReadingDealershipId));
            await command.ExecuteNonQueryAsync(Ct);
        }
        var edit = EditTechnicianAsync("hvLevel", JsonValue.Create(4)!);
        Task<HttpResponseMessage>? publication = null;
        try
        {
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            edit.IsCompleted.ShouldBeFalse("the resource edit also waits for the dealership lock");
            // Queue the edit first, then publication: publication must read the edit's committed roster after its own wait.
            publication = PutAsync(_client, _publication);
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 2, Ct);
            publication.IsCompleted.ShouldBeFalse();
            (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(0);
        }
        finally { await transaction.RollbackAsync(Ct); }
        await edit.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        using var response = await publication!.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "policy-preview-outdated", Ct);
        (await _factory.WithDbAsync(db => db.RequirementPolicyVersions.CountAsync(Ct))).ShouldBe(0);
        (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Publish_without_a_nonempty_token_returns_a_previewToken_field_error(string? token)
    {
        if (token is not null) { _publication["previewToken"] = token; }
        using var response = await PutAsync(_client, _publication);
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation-error", Ct);
        problem.GetProperty("errors").GetProperty("previewToken")[0].GetString()
            .ShouldBe("Publish needs the previewToken of the preview you confirmed.");
        (await _factory.WithDbAsync(db => db.AdminChanges.CountAsync(Ct))).ShouldBe(0);
        (await _factory.WithDbAsync(db => db.RequirementPolicyVersions.CountAsync(Ct))).ShouldBe(0);
    }

    [Theory]
    [InlineData("date")]
    [InlineData("rules")]
    public async Task Publish_cannot_reuse_a_token_for_a_different_date_or_rule_set(string field)
    {
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        if (field == "date") { _publication["previewDate"] = "2026-10-14"; }
        else { _publication["rules"]![1]!["minimumHvLevel"] = 3; }
        var before = await StoredStateAsync();
        using var response = await PutAsync(_client, _publication);
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "policy-preview-outdated", Ct);
        (await StoredStateAsync()).ShouldBe(before);
    }

    [Fact]
    public async Task Committed_publication_replays_the_original_token_even_after_roster_consequences_change()
    {
        var preview = await PreviewAsync();
        _publication["previewToken"] = preview["previewToken"]!.GetValue<string>();
        var fault = new LostCommitAfterRosterEdit(() => EditTechnicianAsync("hvLevel", JsonValue.Create(4)!));
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true")
            .ConfigureTestServices(s => s.AddDbContext<SchedulerDbContext>((_, options) => options.AddInterceptors(fault))));
        using var client = host.CreateClient();
        using var metrics = new MetricsCollector();
        fault.Arm();
        using var saved = await PutAsync(client, _publication);
        fault.Fired.ShouldBe(1);
        await AssertSavedAsync(saved, preview, auditCount: 2);
        metrics.Sum("scheduler.admin.edits").ShouldBe(2);
        using var current = await _client.GetAsync(TechnicianPath, Ct);
        JsonNode.Parse(await current.Content.ReadAsStringAsync(Ct))!["hvLevel"]!.GetValue<int>().ShouldBe(4);
    }

    private async Task<JsonNode> PreviewAsync()
    {
        var body = _publication.DeepClone();
        body["dryRun"] = true;
        using var response = await PutAsync(_client, body);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        response.Headers.ETag!.ToString().ShouldBe(_etag);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;
    }

    private async Task EditTechnicianAsync(string field, JsonNode value)
    {
        using var read = await _client.GetAsync(TechnicianPath, Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        body[field] = value;
        using var request = new HttpRequestMessage(HttpMethod.Put, TechnicianPath)
            { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("If-Match", read.Headers.ETag!.ToString());
        using var response = await _client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
    }

    private async Task<HttpResponseMessage> PutAsync(HttpClient client, JsonNode body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, PolicyPath)
            { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("If-Match", _etag);
        return await client.SendAsync(request, Ct);
    }

    private async Task AssertSavedAsync(HttpResponseMessage response, JsonNode preview, int auditCount = 1)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;
        body["saved"]!.GetValue<bool>().ShouldBeTrue();
        body["policy"]!.ToJsonString().ShouldBe(preview["policy"]!.ToJsonString());
        body["changes"]!.ToJsonString().ShouldBe(preview["changes"]!.ToJsonString());
        body["previewToken"]!.GetValue<string>().ShouldBe(preview["previewToken"]!.GetValue<string>());
        response.Headers.ETag!.ToString().ShouldBe("\"policy-3\"");
        await _factory.WithDbAsync(async db =>
        {
            (await db.RequirementPolicyVersions.CountAsync(Ct)).ShouldBe(1);
            (await db.RequirementRules.CountAsync(r => r.DealershipId == ReferenceDataSeed.ReadingDealershipId && r.PolicyVersion == 3, Ct)).ShouldBe(7);
            (await db.AdminChanges.CountAsync(Ct)).ShouldBe(auditCount);
            (await db.AdminChanges.CountAsync(a => a.ResourceKind == AdminVocabulary.Policy && a.Action == AdminVocabulary.Publish, Ct)).ShouldBe(1);
        });
    }

    private Task<(int Rules, int Versions, int Audit)> StoredStateAsync() => _factory.WithDbAsync(async db =>
        (await db.RequirementRules.CountAsync(Ct), await db.RequirementPolicyVersions.CountAsync(Ct), await db.AdminChanges.CountAsync(Ct)));

    private sealed class LostCommitAfterRosterEdit(Func<Task> edit) : DbTransactionInterceptor
    {
        private int _armed;
        public int Fired { get; private set; }
        public void Arm() => Interlocked.Exchange(ref _armed, 1);

        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref _armed, 0) == 1)
            {
                Fired++;
                await edit();
                throw new NpgsqlException("Simulated lost commit acknowledgement after roster edit", new IOException("Connection reset by peer"));
            }
        }
    }
}

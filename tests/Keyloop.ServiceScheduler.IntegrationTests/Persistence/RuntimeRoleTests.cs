using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

/// <summary>
/// Owner migrates, then psql applies the deployment grants over the old blanket grants twice. Every application operation uses
/// a separate scheduler_app LOGIN connection, including the Production demo's startup seeding. Owner connections are confined to
/// test arrangement, migration and deliberate out-of-band faults. No AppHost or external service is started.
/// </summary>
public sealed class RuntimeRoleTests(PostgresFixture pg) : IAsyncLifetime
{
    private readonly string _database = "runtime_grants_" + Guid.NewGuid().ToString("N");
    private string _ownerConnection = null!;
    private string _runtimeConnection = null!;
    private SchedulerApiFactory _factory = null!;
    private WebApplicationFactory<Program> _host = null!;
    private HttpClient _client = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Site => $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}";

    public async ValueTask InitializeAsync()
    {
        _ownerConnection = await pg.CreateEmptyDatabaseAsync(_database, Ct);
        await using (var db = OwnerDb()) { await db.Database.MigrateAsync(Ct); }
        await OwnerSqlAsync("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scheduler_app') THEN
                CREATE ROLE scheduler_app LOGIN PASSWORD 'runtime-fixture-only';
              END IF;
            END $$;
            GRANT USAGE ON SCHEMA public TO scheduler_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scheduler_app;
            GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO scheduler_app;
            ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scheduler_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scheduler_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO scheduler_app;
            """);
        await pg.RunGrantScriptAsync(_database, verifyOnly: false, Ct);
        await pg.RunGrantScriptAsync(_database, verifyOnly: false, Ct);
        await pg.RunGrantScriptAsync(_database, verifyOnly: true, Ct);
        _runtimeConnection = new NpgsqlConnectionStringBuilder(_ownerConnection)
        {
            Username = "scheduler_app", Password = "runtime-fixture-only",
        }.ConnectionString;
        _factory = new SchedulerApiFactory(_runtimeConnection, TestData.Clock());
        _host = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures/cloudflare-container-env-core.json")));
            foreach (var setting in fixture.RootElement.EnumerateObject())
            {
                if (setting.Name != "ConnectionStrings__schedulerdb")
                {
                    builder.UseSetting(setting.Name.Replace("__", ":", StringComparison.Ordinal), setting.Value.GetString());
                }
            }
            // Test authentication was installed by SchedulerApiFactory. Keep network/rate limits out of grant proofs.
            builder.UseSetting("Security:RateLimiting:Enabled", "false");
        });
        _client = _host.CreateClient(); // Runtime startup seeds the empty migrated database.
        await RuntimeDbAsync(async db =>
        {
            (await db.Database.SqlQuery<string>($"""SELECT current_user::text AS "Value" """).SingleAsync(Ct)).ShouldBe("scheduler_app");
        });
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_host is not null) { await _host.DisposeAsync(); }
        if (_factory is not null) { await _factory.DisposeAsync(); }
        // Each test has its own database and two pools (owner and runtime); release them so the shared server's connections do not run out.
        if (_ownerConnection is not null) { await pg.ReleaseDatabaseAsync(_database, _ownerConnection, _runtimeConnection ?? _ownerConnection); }
    }

    [Fact]
    public async Task Startup_and_repeat_start_seed_the_demo_as_runtime_without_migrations_or_reseed()
    {
        var options = _host.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value;
        (options.MigrateOnStartup, options.SeedDemoData).ShouldBe((false, true));
        using var health = await _client.GetAsync("/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        var ids = await RuntimeDbAsync(db => db.Appointments.OrderBy(a => a.Id).Select(a => a.Id).ToListAsync(Ct));
        ids.ShouldNotBeEmpty();
        await DatabaseInitializer.InitializeAsync(_host.Services, Ct);
        (await RuntimeDbAsync(db => db.Appointments.OrderBy(a => a.Id).Select(a => a.Id).ToListAsync(Ct))).ShouldBe(ids);
        (await RuntimeDbAsync(db => db.AppointmentHistory.CountAsync(Ct))).ShouldBe(ids.Count);
        (await RuntimeDbAsync(db => db.NotificationOutbox.CountAsync(Ct))).ShouldBe(ids.Count);
        using var reseed = await _client.PostAsync("/api/v1/admin/demo/reseed", null, Ct);
        reseed.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Startup_additive_catalogue_and_policy_upgrade_uses_insert_only_grants()
    {
        // Arrange a pre-Task-32a database as owner, then run the actual startup initializer as runtime.
        await using (var owner = OwnerDb()) { await PolicyPublicationProbe.RevertToBeforeTask32aAsync(owner, Ct); }
        await DatabaseInitializer.InitializeAsync(_host.Services, Ct);
        await RuntimeDbAsync(async db =>
        {
            (await db.ServiceTypes.CountAsync(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT", Ct)).ShouldBe(1);
            (await db.RequirementRules.CountAsync(r => r.Code == RequirementRule.PostCollisionRuleCode && r.PolicyVersion == 2, Ct)).ShouldBe(2);
        });
    }

    [Fact]
    public async Task Public_reads_can_succeed_one_migration_behind_while_runtime_readiness_fails()
    {
        await using var owner = OwnerDb();
        var migrations = owner.Database.GetMigrations().ToArray();
        await owner.Database.MigrateAsync(migrations[^2], Ct);
        using var dealerships = await _client.GetAsync("/api/v1/dealerships", Ct);
        dealerships.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var schedule = await _client.GetAsync(Site + "/schedule?date=2026-10-13", Ct);
        schedule.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var notReady = await _client.GetAsync("/health", Ct);
        notReady.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        await owner.Database.MigrateAsync(Ct);
        using var ready = await _client.GetAsync("/health", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Booking_cancel_replay_and_expired_key_replacement_work_as_runtime(bool vehicleAware)
    {
        await using var host = _host.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", vehicleAware ? "true" : "false"));
        using var client = host.CreateClient();
        var before = await RuntimeDbAsync(db => db.Appointments.CountAsync(Ct));
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(16, 30), customerIndex: 701);
        var headers = new Dictionary<string, string> { ["Idempotency-Key"] = "runtime-proof" };
        using var booked = await client.PostJsonAsync(Site + "/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created, await booked.Content.ReadAsStringAsync(Ct));
        var id = JsonNode.Parse(await booked.Content.ReadAsStringAsync(Ct))!["id"]!.GetValue<Guid>();
        using var replay = await client.PostJsonAsync(Site + "/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        replay.StatusCode.ShouldBe(HttpStatusCode.Created);
        replay.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        using var cancel = await SendAsync(client, HttpMethod.Post, $"/api/v1/appointments/{id}/cancel", "{\"reason\":\"Grant proof\"}");
        cancel.StatusCode.ShouldBe(HttpStatusCode.OK, await cancel.Content.ReadAsStringAsync(Ct));
        // Clock-independent expiry arrangement; replacement DELETE is performed by the real booking handler as runtime.
        await OwnerSqlAsync("UPDATE idempotency_keys SET expires_at_utc = '2026-10-11T00:00:00Z' WHERE key = 'runtime-proof'");
        using var replaced = await client.PostJsonAsync(Site + "/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        replaced.StatusCode.ShouldBe(HttpStatusCode.Created, await replaced.Content.ReadAsStringAsync(Ct));
        var replacementId = JsonNode.Parse(await replaced.Content.ReadAsStringAsync(Ct))!["id"]!.GetValue<Guid>();
        replacementId.ShouldNotBe(id);
        await RuntimeDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(before + 2);
            (await db.AppointmentHistory.CountAsync(h => h.AppointmentId == id, Ct)).ShouldBe(2);
            (await db.IdempotencyKeys.SingleAsync(Ct)).ResourceId.ShouldBe(replacementId);
            (await db.NotificationOutbox.CountAsync(n => n.AppointmentId == id, Ct)).ShouldBe(2);
        });
        using var lookup = await SendAsync(client, HttpMethod.Post, Site + "/customer-lookups", "{\"query\":\"customer701@\"}");
        lookup.StatusCode.ShouldBe(HttpStatusCode.OK, await lookup.Content.ReadAsStringAsync(Ct));
        JsonNode.Parse(await lookup.Content.ReadAsStringAsync(Ct))!.AsArray().ShouldHaveSingleItem();
    }

    [Theory]
    [InlineData("technicians", "{\"name\":\"Grant technician\",\"employeeNumber\":\"GR-1\",\"certifications\":[\"GeneralService\"],\"isActive\":true,\"hvLevel\":2,\"hvLevelValidUntil\":null,\"hvLevelConfirmed\":false,\"brandSpecialisms\":[]}")]
    [InlineData("bays", "{\"name\":\"Grant bay\",\"capabilities\":[\"StandardLift\"],\"isActive\":true}")]
    public async Task Admin_create_edit_deactivate_reactivate_and_confirmation_append_audit_as_runtime(string kind, string json)
    {
        using var created = await SendAsync(_client, HttpMethod.Post, Site + "/" + kind, json);
        created.StatusCode.ShouldBe(HttpStatusCode.Created, await created.Content.ReadAsStringAsync(Ct));
        var path = created.Headers.Location!.ToString();
        var tag = created.Headers.ETag!.ToString();
        var body = JsonNode.Parse(await created.Content.ReadAsStringAsync(Ct))!;
        foreach (var active in new[] { false, true })
        {
            body["isActive"] = active;
            body["name"] = active ? "Grant resource reactivated" : "Grant resource edited";
            using var saved = await SendAsync(_client, HttpMethod.Put, path, body.ToJsonString(), tag);
            saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
            tag = saved.Headers.ETag!.ToString();
        }
        if (kind == "technicians")
        {
            using var confirmed = await SendAsync(_client, HttpMethod.Post, path + "/confirm-hv-level", null, tag);
            confirmed.StatusCode.ShouldBe(HttpStatusCode.OK, await confirmed.Content.ReadAsStringAsync(Ct));
        }
        using var history = await _client.GetAsync(Site + "/admin-history", Ct);
        history.StatusCode.ShouldBe(HttpStatusCode.OK);
        JsonNode.Parse(await history.Content.ReadAsStringAsync(Ct))!["items"]!.AsArray().Count.ShouldBe(kind == "technicians" ? 4 : 3);
    }

    [Fact]
    public async Task Policy_preview_and_publication_retain_old_versions_and_append_audit_as_runtime()
    {
        var path = Site + "/requirement-policy";
        using var read = await _client.GetAsync(path, Ct);
        var body = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
        var beforeVersion = body["version"]!.GetValue<int>();
        var beforeRules = await RuntimeDbAsync(db => db.RequirementRules.CountAsync(Ct));
        body["dryRun"] = true;
        body["previewDate"] = "2026-10-13";
        body["rules"]![0]!["minimumHvLevel"] = 3;
        using var preview = await SendAsync(_client, HttpMethod.Put, path, body.ToJsonString(), read.Headers.ETag!.ToString());
        preview.StatusCode.ShouldBe(HttpStatusCode.OK, await preview.Content.ReadAsStringAsync(Ct));
        body["dryRun"] = false;
        body["previewToken"] = JsonNode.Parse(await preview.Content.ReadAsStringAsync(Ct))!["previewToken"]!.GetValue<string>();
        using var saved = await SendAsync(_client, HttpMethod.Put, path, body.ToJsonString(), read.Headers.ETag!.ToString());
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
        await RuntimeDbAsync(async db =>
        {
            (await db.RequirementPolicyVersions.SingleAsync(Ct)).Version.ShouldBe(beforeVersion + 1);
            (await db.RequirementRules.CountAsync(Ct)).ShouldBe(beforeRules + body["rules"]!.AsArray().Count);
            (await db.AdminChanges.CountAsync(Ct)).ShouldBe(1);
        });
    }

    [Theory]
    [InlineData("sent")]
    [InlineData("retry-exhausted")]
    [InlineData("lease-recovered")]
    [InlineData("render-failed")]
    public async Task Outbox_claim_lease_ack_retry_and_dead_letter_work_as_runtime(string outcome)
    {
        var request = TestData.BookingRequest(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE"), TestData.LondonTime(16, 30), email: TestData.DeliverableEmail());
        using var booked = await _client.PostJsonAsync(Site + "/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, ct: Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        var sender = new CapturingEmailSender();
        var options = new NotificationOptions { Enabled = true, Provider = NotificationProvider.Smtp, MaxAttempts = 2 };
        if (outcome == "retry-exhausted") { sender.OnSend = (_, _) => Task.FromException(new IOException("fixture failure")); }
        if (outcome == "render-failed") { await OwnerSqlAsync("UPDATE notification_outbox SET payload = '{}' WHERE status = 'Pending'"); }
        if (outcome == "lease-recovered")
        {
            await RuntimeDbAsync(async db =>
            {
                var row = await db.NotificationOutbox.SingleAsync(n => n.Status == NotificationStatus.Pending, Ct);
                row.Claim(_factory.Clock.GetUtcNow().UtcDateTime, options.ClaimLease);
                await db.SaveChangesAsync(Ct);
            });
        }
        using var dispatcher = new NotificationDispatcher(_host.Services.GetRequiredService<IServiceScopeFactory>(), sender,
            new NotificationSignal(), Options.Create(options), _factory.Clock, NullLogger<NotificationDispatcher>.Instance);
        if (outcome == "lease-recovered")
        {
            (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(0);
            _factory.Clock.Advance(options.ClaimLease);
        }
        (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        if (outcome == "retry-exhausted")
        {
            var next = await RuntimeDbAsync(db => db.NotificationOutbox.Where(n => n.Status == NotificationStatus.Pending).Select(n => n.NextAttemptAt).SingleAsync(Ct));
            _factory.Clock.SetUtcNow(new DateTimeOffset(next));
            (await dispatcher.DispatchOnceAsync(Ct)).ShouldBe(1);
        }
        var final = await RuntimeDbAsync(db => db.NotificationOutbox.SingleAsync(n => n.Recipient == TestData.DeliverableEmail(), Ct));
        final.Status.ShouldBe(outcome is "render-failed" or "retry-exhausted" ? NotificationStatus.Failed : NotificationStatus.Sent);
        final.ClaimToken.ShouldBeNull();
        sender.Messages.Count.ShouldBe(outcome == "render-failed" ? 0 : outcome == "retry-exhausted" ? 2 : 1);
    }

    [Fact]
    public async Task Triage_and_photo_upload_use_runtime_reads_and_private_stub_storage_without_database_writes()
    {
        using var stub = new StubTriageHandler();
        using var relay = new StubTriageMediaRelay();
        await using var host = _host.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
        {
            services.PostConfigure<TriageConnectionOptions>(o =>
            {
                o.Enabled = true; o.AccountId = "00000000000000000000000000000000"; o.ApiToken = "test-token";
                o.BaseUrl = "https://triage.test/client/v4"; o.ImageStoreUrl = "http://triage-media.internal";
            });
            services.AddHttpClient<CloudflareTriageClient>().ConfigurePrimaryHttpMessageHandler(() => stub);
            services.AddHttpClient<TriageImageStore>().ConfigurePrimaryHttpMessageHandler(() => relay);
        }));
        using var client = host.CreateClient();
        // The private R2 relay is fully stubbed: photos require no PostgreSQL write privilege.
        var bytes = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory,
            "Fixtures/triage-plain-3x2.png"), Ct);
        using var uploaded = await SendAsync(client, HttpMethod.Post, Site + "/booking-triage/images",
            new JsonObject { ["contentType"] = "image/png", ["base64"] = Convert.ToBase64String(bytes) }.ToJsonString());
        uploaded.StatusCode.ShouldBe(HttpStatusCode.OK, await uploaded.Content.ReadAsStringAsync(Ct));
        var image = JsonNode.Parse(await uploaded.Content.ReadAsStringAsync(Ct))!;
        using var response = await SendAsync(client, HttpMethod.Post, Site + "/booking-triage",
            new JsonObject { ["description"] = "Brakes squeal", ["imageIds"] = new JsonArray(image["imageId"]!.GetValue<string>()) }.ToJsonString());
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        stub.Calls.ShouldBe(1);
        stub.Body!["images"]!.AsArray().ShouldHaveSingleItem();
        relay.Requests.Select(r => r.Method).ShouldBe([HttpMethod.Put, HttpMethod.Get]);
    }

    [Fact]
    public async Task Forbidden_mutations_fail_and_future_tables_and_sequences_receive_no_grants()
    {
        await using var runtime = new NpgsqlConnection(_runtimeConnection);
        await runtime.OpenAsync(Ct);
        foreach (var sql in new[]
        {
            "UPDATE appointment_history SET actor = actor WHERE false", "DELETE FROM appointment_history WHERE false",
            "UPDATE admin_changes SET actor = actor WHERE false", "DELETE FROM admin_changes WHERE false",
            "DELETE FROM appointments WHERE false", "UPDATE requirement_rules SET code = code WHERE false",
            "DELETE FROM requirement_policy_versions WHERE false", "INSERT INTO \"__EFMigrationsHistory\" VALUES ('probe', 'probe')",
            "CREATE TABLE public.runtime_ddl_probe (id int)", "TRUNCATE appointments",
        })
        {
            await using var command = new NpgsqlCommand(sql, runtime);
            (await Should.ThrowAsync<PostgresException>(() => command.ExecuteNonQueryAsync(Ct))).SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
        }
        await OwnerSqlAsync("CREATE TABLE public.future_grant_probe (id int); CREATE SEQUENCE public.future_sequence_probe;");
        await using (var command = new NpgsqlCommand("SELECT has_table_privilege(current_user, 'public.future_grant_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_sequence_privilege(current_user, 'public.future_sequence_probe', 'USAGE,SELECT,UPDATE')", runtime))
        {
            (await command.ExecuteScalarAsync(Ct)).ShouldBe(false);
        }
        await pg.RunGrantScriptAsync(_database, verifyOnly: true, Ct);
        // The runner's independent postcondition must detect privilege regressions even after the grant script returned success.
        await OwnerSqlAsync("GRANT UPDATE, DELETE ON appointment_history TO scheduler_app; GRANT DELETE ON appointments TO scheduler_app;");
        await pg.RunGrantScriptAsync(_database, verifyOnly: true, Ct, succeeds: false);
        await pg.RunGrantScriptAsync(_database, verifyOnly: false, Ct); // Reapplication repairs existing excess rights.
    }

    [Fact]
    public async Task Owner_Development_reseed_still_works_without_widening_runtime_rights()
    {
        const string key = "fixture-reseed-key-43b";
        await using var ownerFactory = new SchedulerApiFactory(_ownerConnection, _factory.Clock);
        await using var dev = ownerFactory.WithWebHostBuilder(b => b.UseEnvironment("Development")
            .UseSetting("Database:MigrateOnStartup", "false").UseSetting("Database:SeedDemoData", "true")
            .UseSetting("Demo:ReseedKey", key));
        using var client = dev.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/admin/demo/reseed");
        request.Headers.Add("X-Reseed-Key", key);
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;
        body["appointmentsDeleted"]!.GetValue<int>().ShouldBePositive();
        body["appointmentsCreated"]!.GetValue<int>().ShouldBePositive();
        await pg.RunGrantScriptAsync(_database, verifyOnly: true, Ct);
    }

    private SchedulerDbContext OwnerDb() => new(new DbContextOptionsBuilder<SchedulerDbContext>()
        .UseNpgsql(_ownerConnection).UseSnakeCaseNamingConvention().Options);

    private async Task OwnerSqlAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(_ownerConnection);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(Ct);
    }

    private async Task<T> RuntimeDbAsync<T>(Func<SchedulerDbContext, Task<T>> work)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }

    private async Task RuntimeDbAsync(Func<SchedulerDbContext, Task> work)
    {
        await using var scope = _host.Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, string? json, string? etag = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (json is not null) { request.Content = new StringContent(json, Encoding.UTF8, "application/json"); }
        if (etag is not null) { request.Headers.TryAddWithoutValidation("If-Match", etag); }
        return await client.SendAsync(request, Ct);
    }
}

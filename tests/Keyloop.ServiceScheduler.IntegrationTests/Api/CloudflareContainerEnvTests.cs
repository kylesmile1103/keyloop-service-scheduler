using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Verifies API startup, forwarding, OTLP export, and feature flags using the committed Cloudflare Worker container environment fixtures.</summary>
public sealed class CloudflareContainerEnvTests(PostgresFixture pg) : IDisposable
{
    private const string FixtureFile = "cloudflare-container-env-core.json";
    private const string OtlpFixtureFile = "cloudflare-container-env-otlp.json";
    private const string VehicleAwareFixtureFile = "cloudflare-container-env-vehicle-aware.json";
    private const string VehicleAwareSwitch = "Scheduling__VehicleAwareRequirements";
    private const string PublicHost = "http://keyloop.kylesmile.me";
    private readonly RSA _rsa = RSA.Create(2048);
    private readonly IReadOnlyDictionary<string, string> _workerEnv = ReadWorkerEnv(FixtureFile);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose() => _rsa.Dispose();

    [Fact]
    public async Task Worker_core_env_starts_Production_seeding_demo_data_without_migrating_or_a_reseed_key()
    {
        await using var host = await WorkerHostAsync("cloudflare_env_start");
        using var client = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(PublicHost), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Clear();

        var services = host.Services;
        var database = services.GetRequiredService<IOptions<DatabaseOptions>>().Value;
        (database.MigrateOnStartup, database.SeedDemoData).ShouldBe((false, true));
        services.GetRequiredService<IOptions<DemoOptions>>().Value.ReseedEnabled(database).ShouldBeFalse("the Worker passes an empty key");
        var notifications = services.GetRequiredService<IOptions<NotificationOptions>>().Value;
        (notifications.Enabled, notifications.Provider).ShouldBe((false, NotificationProvider.None));
        services.GetRequiredService<IEmailSender>().ShouldBeOfType<DisabledEmailSender>();
        var security = services.GetRequiredService<IOptions<SecurityOptions>>().Value;
        (security.RateLimiting.BookingPermitsPerMinute, security.RateLimiting.GlobalPermitsPerMinute).ShouldBe((120, 300));
        security.ForwardedHeaders.Enabled.ShouldBeTrue();
        security.ForwardedHeaders.KnownNetworks.ShouldBe(["0.0.0.0/0", "::/0"]);
        var auth = services.GetRequiredService<IOptions<AuthOptions>>().Value;
        (auth.Mode, auth.TeamDomain).ShouldBe((AuthMode.CloudflareAccess, _workerEnv["Auth__TeamDomain"]));
        auth.Audience.ShouldBe([_workerEnv["Auth__Audience__0"]]);

        _workerEnv.Keys.ShouldNotContain(key => key.StartsWith("OTEL_", StringComparison.Ordinal));
        services.GetRequiredService<IConfiguration>()["OTEL_EXPORTER_OTLP_ENDPOINT"].ShouldBeNullOrWhiteSpace();

        _workerEnv.Keys.ShouldNotContain(key => key.StartsWith("Scheduling__", StringComparison.Ordinal));
        services.GetRequiredService<IOptions<SchedulingOptions>>().Value.VehicleAwareRequirements.ShouldBeFalse();

        using (var dealerships = await SendAsync(client, HttpMethod.Get, "/api/v1/dealerships"))
        {
            dealerships.StatusCode.ShouldBe(HttpStatusCode.OK);
            using var body = JsonDocument.Parse(await dealerships.Content.ReadAsStringAsync(Ct));
            body.RootElement.GetArrayLength().ShouldBe(2);
        }

        await using (var scope = services.CreateAsyncScope())
        {
            (await scope.ServiceProvider.GetRequiredService<SchedulerDbContext>().Appointments.CountAsync(Ct)).ShouldBePositive();
        }

        (await RolesAsync(client, "admin@fixture.test")).ShouldBe(["Admin"]);
        (await RolesAsync(client, "advisor@fixture.test")).ShouldBe(["ServiceAdvisor"]);
        (await RolesAsync(client, "someone@viewers.fixture.test")).ShouldBe(["Viewer"]);
        (await RolesAsync(client, "unassigned@fixture.test")).ShouldBeEmpty();

        using (var reseed = await SendAsync(client, HttpMethod.Post, "/api/v1/admin/demo/reseed", Token("admin@fixture.test")))
        {
            reseed.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }

        (await SendAsync(client, HttpMethod.Get, "/scalar/v1")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await SendAsync(client, HttpMethod.Get, "/openapi/v1.json")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Worker_forwarding_headers_set_the_client_and_scheme_before_rate_limiting()
    {
        await using var host = await WorkerHostAsync("cloudflare_env_forwarding");
        using var client = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(PublicHost), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Clear();
        var bookings = $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/appointments";

        for (var attempt = 1; attempt <= 120; attempt++)
        {
            using var allowed = await SendAsync(client, HttpMethod.Post, bookings, forwardedFor: "203.0.113.7");
            allowed.StatusCode.ShouldBe(HttpStatusCode.Unauthorized, $"attempt {attempt}");
            allowed.Headers.Contains("Strict-Transport-Security").ShouldBeTrue();
        }

        using (var limited = await SendAsync(client, HttpMethod.Post, bookings, forwardedFor: "203.0.113.7"))
        {
            limited.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests, "the Worker profile allows 120 booking writes a minute per client");
        }

        using var another = await SendAsync(client, HttpMethod.Post, bookings, forwardedFor: "198.51.100.20");
        another.StatusCode.ShouldBe(HttpStatusCode.Unauthorized, "another client keeps its own budget");
    }

    [Fact]
    public async Task Worker_otlp_env_exports_every_signal_as_the_dashboards_job_without_printing_the_credential()
    {
        var otlpEnv = ReadWorkerEnv(OtlpFixtureFile);
        otlpEnv.Where(entry => !entry.Key.StartsWith("OTEL_", StringComparison.Ordinal)).OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ShouldBe(_workerEnv.OrderBy(entry => entry.Key, StringComparer.Ordinal));
        const string HeaderPrefix = "Authorization=Basic%20";
        var header = otlpEnv["OTEL_EXPORTER_OTLP_HEADERS"];
        header.ShouldStartWith(HeaderPrefix);
        var credential = header[HeaderPrefix.Length..];
        var instanceAndToken = Encoding.ASCII.GetString(Convert.FromBase64String(credential)).Split(':', 2);
        instanceAndToken[0].ShouldBe("123456");
        var token = instanceAndToken[1];
        credential.ShouldContain('+');
        credential.ShouldContain('/');
        credential.ShouldEndWith("==");

        await using var receiver = await OtlpReceiver.StartAsync(Ct);
        var logs = new CapturingLoggerProvider();
        await using (var host = await WorkerHostAsync("cloudflare_env_otlp", otlpEnv, logs, new Dictionary<string, string>
        {
            // Redirect OTLP export to the local receiver with shortened flush intervals.
            ["OTEL_EXPORTER_OTLP_ENDPOINT"] = receiver.Endpoint,
            ["OTEL_METRIC_EXPORT_INTERVAL"] = "500",
            ["OTEL_BSP_SCHEDULE_DELAY"] = "200",
            ["OTEL_BLRP_SCHEDULE_DELAY"] = "200",
        }))
        {
            using var client = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(PublicHost), AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Clear();
            using (var dealerships = await SendAsync(client, HttpMethod.Get, "/api/v1/dealerships"))
            {
                dealerships.StatusCode.ShouldBe(HttpStatusCode.OK);
            }

            (await RolesAsync(client, "admin@fixture.test")).ShouldBe(["Admin"]);
            await receiver.WaitForPathsAsync(["/otlp/v1/traces", "/otlp/v1/metrics", "/otlp/v1/logs"], TimeSpan.FromSeconds(30), Ct);
        }

        var exports = receiver.Exports;
        exports.ShouldNotBeEmpty();
        foreach (var export in exports)
        {
            export.Path.ShouldBeOneOf("/otlp/v1/traces", "/otlp/v1/metrics", "/otlp/v1/logs");
            export.ContentType.ShouldBe("application/x-protobuf", "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf");
            export.Authorization.ShouldBe($"Basic {credential}", "the percent-encoded header decodes to the Basic credential intact");
            var resource = export.ResourceAttributes();
            $"{resource["service.namespace"]}/{resource["service.name"]}".ShouldBe("keyloop-scheduler/api", export.Path);
            resource["deployment.environment.name"].ShouldBe("Production", export.Path);
            ContainsAscii(export.Body, token).ShouldBeFalse($"{export.Path} exported the token");
            ContainsAscii(export.Body, credential).ShouldBeFalse($"{export.Path} exported the credential");
        }

        var entries = logs.Entries;
        entries.ShouldContain(entry => entry.EventId.Id == 1102, "the capture sees the API's own Information events");
        foreach (var entry in entries)
        {
            var text = string.Join('\n', [entry.Message, entry.Exception?.ToString(),
                .. entry.State.Select(property => $"{property.Key}={property.Value}"),
                .. entry.Scopes.Select(property => $"{property.Key}={property.Value}")]);
            foreach (var secret in new[] { token, credential, header })
            {
                text.ShouldNotContain(secret, Case.Sensitive, $"{entry.Category} {entry.EventId}");
            }
        }

        entries.ShouldNotContain(entry => entry.Level < LogLevel.Warning && ChattyCategories.Any(prefix => entry.Category.StartsWith(prefix, StringComparison.Ordinal)),
            string.Join(", ", entries.Where(entry => entry.Level < LogLevel.Warning).Select(entry => entry.Category).Distinct()));
    }

    [Fact]
    public async Task Worker_vehicle_aware_env_turns_on_ADR_029_in_Production_and_the_public_features_report_it()
    {
        var vehicleAwareEnv = ReadWorkerEnv(VehicleAwareFixtureFile);
        vehicleAwareEnv[VehicleAwareSwitch].ShouldBe("true");
        vehicleAwareEnv.Where(entry => entry.Key != VehicleAwareSwitch).OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ShouldBe(_workerEnv.OrderBy(entry => entry.Key, StringComparer.Ordinal));

        await using var host = await WorkerHostAsync("cloudflare_env_vehicle_aware", vehicleAwareEnv, null, null);
        using var client = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(PublicHost), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Clear();

        var scheduling = host.Services.GetRequiredService<IOptions<SchedulingOptions>>().Value;
        (scheduling.VehicleAwareRequirements, scheduling.MinimumLeadTime).ShouldBe((true, TimeSpan.FromHours(1)));

        using (var features = await SendAsync(client, HttpMethod.Get, "/api/v1/features"))
        {
            features.StatusCode.ShouldBe(HttpStatusCode.OK);
            using var body = JsonDocument.Parse(await features.Content.ReadAsStringAsync(Ct));
            body.RootElement.GetProperty("vehicleAwareRequirements").GetBoolean().ShouldBeTrue();
        }

        var availability = $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/availability" +
            $"?serviceTypeId={ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE")}&date=2026-10-13&powertrain=Ice&vehicleClass=Car";
        using var answered = await SendAsync(client, HttpMethod.Get, availability);
        answered.StatusCode.ShouldBe(HttpStatusCode.OK, await answered.Content.ReadAsStringAsync(Ct));
    }

    private static readonly string[] ChattyCategories = ["Microsoft.EntityFrameworkCore.Database.Command", "System.Net.Http.HttpClient.", "Polly"];

    private static bool ContainsAscii(byte[] haystack, string needle) => haystack.AsSpan().IndexOf(Encoding.ASCII.GetBytes(needle)) >= 0;

    private Task<WebApplicationFactory<Program>> WorkerHostAsync(string databaseName) => WorkerHostAsync(databaseName, _workerEnv, null, null);

    private async Task<WebApplicationFactory<Program>> WorkerHostAsync(string databaseName, IReadOnlyDictionary<string, string> workerEnv,
        CapturingLoggerProvider? logs, IReadOnlyDictionary<string, string>? overrides)
    {
        var connectionString = await pg.CreateEmptyDatabaseAsync(databaseName, Ct);
        await using (var operatorContext = new SchedulerDbContext(
            new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options))
        {
            await operatorContext.Database.MigrateAsync(Ct);
        }

        var jwks = Jwks();
        var team = workerEnv["Auth__TeamDomain"];
        var factory = new SchedulerApiFactory(connectionString, TestData.Clock(), logs);
        return factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(workerEnv["ASPNETCORE_ENVIRONMENT"]);
            foreach (var (key, value) in workerEnv.Where(entry => !entry.Key.StartsWith("ASPNETCORE_", StringComparison.Ordinal))
                .Concat(overrides ?? new Dictionary<string, string>()))
            {
                builder.UseSetting(key.Replace("__", ":", StringComparison.Ordinal), value);
            }

            builder.UseSetting("ConnectionStrings:schedulerdb", connectionString);
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    options.DefaultAuthenticateScheme = SchedulerAuthentication.Scheme;
                    options.DefaultChallengeScheme = SchedulerAuthentication.Scheme;
                    options.DefaultForbidScheme = SchedulerAuthentication.Scheme;
                });
                services.AddHttpClient("AccessJwks").ConfigurePrimaryHttpMessageHandler(() => new StubKeys(team, jwks));
                services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter>(new SimulatedIngress(IPAddress.Parse("10.1.2.3")));
            });
        });
    }

    private static IReadOnlyDictionary<string, string> ReadWorkerEnv(string fixtureFile)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", fixtureFile)));
        return document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.GetString()!, StringComparer.Ordinal);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, string? token = null,
        string forwardedFor = "192.0.2.10")
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        request.Headers.Add("X-Forwarded-Proto", "https");
        if (token is not null)
        {
            request.Headers.Add("Cookie", $"CF_Authorization={token}");
        }

        if (method == HttpMethod.Post)
        {
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(request, Ct);
    }

    private async Task<string[]> RolesAsync(HttpClient client, string email)
    {
        using var response = await SendAsync(client, HttpMethod.Get, "/api/v1/me", Token(email));
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        body.RootElement.GetProperty("authenticated").GetBoolean().ShouldBeTrue(email);
        return [.. body.RootElement.GetProperty("roles").EnumerateArray().Select(role => role.GetString()!)];
    }

    private string Token(string email)
    {
        var now = TestData.DefaultNow.ToUnixTimeSeconds();
        var header = new JsonObject { ["alg"] = "RS256", ["kid"] = "worker-env-key" };
        var payload = new JsonObject
        {
            ["iss"] = _workerEnv["Auth__TeamDomain"], ["aud"] = new JsonArray(_workerEnv["Auth__Audience__0"]), ["exp"] = now + 300,
            ["nbf"] = now - 1, ["email"] = email, ["sub"] = "local-user",
        };
        var input = $"{Base64UrlEncoder.Encode(header.ToJsonString())}.{Base64UrlEncoder.Encode(payload.ToJsonString())}";
        return $"{input}.{Base64UrlEncoder.Encode(_rsa.SignData(Encoding.UTF8.GetBytes(input), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))}";
    }

    private string Jwks()
    {
        var key = _rsa.ExportParameters(false);
        return new JsonObject
        {
            ["keys"] = new JsonArray(new JsonObject
            {
                ["kty"] = "RSA", ["kid"] = "worker-env-key", ["n"] = Base64UrlEncoder.Encode(key.Modulus!), ["e"] = Base64UrlEncoder.Encode(key.Exponent!),
            }),
        }.ToJsonString();
    }

    private sealed class StubKeys(string team, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.RequestUri!.AbsoluteUri.ShouldBe($"{team}/cdn-cgi/access/certs");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
        }
    }
}

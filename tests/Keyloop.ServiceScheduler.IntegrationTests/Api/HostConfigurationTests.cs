using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Composition-root behaviour: JSON resolver chain, options validation at startup, rate limiting, per-environment mapping.</summary>
public sealed class HostConfigurationTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public void Json_is_reflection_free_with_the_scheduler_context_first_in_the_chain()
    {
        // The test process mirrors the API's feature switch, so a type missing from the contexts fails here as it would in production.
        JsonSerializer.IsReflectionEnabledByDefault.ShouldBeFalse();

        var options = _factory.Services.GetRequiredService<IOptions<JsonOptions>>().Value.SerializerOptions;
        options.TypeInfoResolverChain[0].ShouldBeSameAs(SchedulerJsonContext.Default);
        options.TypeInfoResolverChain.Select(resolver => resolver.GetType().Name).ShouldContain("ProblemDetailsJsonContext");
        options.TryGetTypeInfo(typeof(NotRegistered), out _).ShouldBeFalse();
        options.NumberHandling.ShouldBe(JsonNumberHandling.Strict, "the web defaults would also read numbers from strings");
    }

    [Theory]
    [InlineData("granularity", "Scheduling:SlotGranularityMinutes", "90", "SchedulingOptions", "SlotGranularityMinutes")]
    [InlineData("permits", "Security:RateLimiting:GlobalPermitsPerMinute", "0", "SecurityOptions", "GlobalPermitsPerMinute")]
    [InlineData("wildcard", "Security:AllowedOrigins:0", "*", "SecurityOptions", "AllowedOrigins")]
    [InlineData("proxy", "Security:ForwardedHeaders:KnownProxies:0", "not-an-ip", "SecurityOptions", "KnownProxies")]
    [InlineData("network", "Security:ForwardedHeaders:KnownNetworks:0", "10.0.0.0/33", "SecurityOptions", "KnownNetworks")]
    [InlineData("trust_all", "Security:ForwardedHeaders:Enabled", "true", "SecurityOptions", "ForwardedHeaders")]
    [InlineData("reseed_key", "Demo:ReseedKey", "too-short", "DemoOptions", "ReseedKey")]
    public async Task Invalid_configuration_fails_startup_before_any_database_work(string name, string key, string value, string optionsType, string member)
    {
        // A fresh, empty database: if startup migrated before validating, the history table would exist afterwards.
        var connectionString = await pg.CreateEmptyDatabaseAsync($"startup_failure_{name}", Ct);
        using var factory = new SchedulerApiFactory(connectionString, TestData.Clock()).WithWebHostBuilder(builder => builder.UseSetting(key, value));

        var ex = Should.Throw<Exception>(() => factory.CreateClient());

        var validation = Find<OptionsValidationException>(ex).ShouldNotBeNull(ex.ToString());
        validation.OptionsType.Name.ShouldBe(optionsType);
        validation.Message.ShouldContain(member);
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(Ct);
        await using var historyExists = new NpgsqlCommand("""SELECT to_regclass('"__EFMigrationsHistory"') IS NOT NULL""", connection);
        ((bool)(await historyExists.ExecuteScalarAsync(Ct))!).ShouldBeFalse("options are validated before migrating or seeding");
    }

    [Theory]
    [InlineData("application/json")]
    [InlineData("text/plain")]
    public async Task Rate_limited_request_is_429_with_Retry_After_whatever_the_client_accepts(string accept)
    {
        // Migrate the shared database first, so this host's log holds only the requests below: when it is the first host to start,
        // EF's Migrate reports its probe of the missing history table as a command error (Information since Program.cs lowers it).
        _ = _factory.Services;
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "1")
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Accept.ParseAdd(accept);

        using var allowed = await client.GetAsync("/api/v1/__throw?kind=ok", Ct);
        allowed.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var limited = await client.GetAsync("/api/v1/__throw?kind=ok", Ct);
        limited.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        var retryAfter = limited.Headers.RetryAfter?.Delta ?? TimeSpan.Zero;
        retryAfter.ShouldBeInRange(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(60));
        limited.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
        var body = await limited.Content.ReadAsStringAsync(Ct);
        if (accept == "application/json")
        {
            limited.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("application/problem+json");
            using var document = JsonDocument.Parse(body);
            var problem = document.RootElement;
            problem.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/rate-limited");
            problem.GetProperty("title").GetString().ShouldBe("Too many requests");
            problem.GetProperty("status").GetInt32().ShouldBe(429);
            problem.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
            problem.GetProperty("retryAfterSeconds").GetInt32().ShouldBe((int)retryAfter.TotalSeconds);
        }
        else
        {
            // No problem body can be written for this client; the status-code pages middleware answers in plain text instead.
            limited.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("text/plain");
            body.ShouldContain("429");
        }

        logs.Entries.ShouldNotContain(entry => entry.Level >= LogLevel.Error, string.Join(Environment.NewLine, logs.Entries.Where(e => e.Level >= LogLevel.Error)));

        using var probe = await client.GetAsync("/alive", Ct);
        probe.StatusCode.ShouldBe(HttpStatusCode.OK, "health probes are exempt from rate limiting");
    }

    [Fact]
    public async Task Forwarded_client_address_from_a_trusted_proxy_drives_rate_limit_partitions_and_the_actor()
    {
        await using var factory = BehindIngress(forwardedHeaders: true, knownProxy: "127.0.0.1", globalPermitsPerMinute: 1);
        using var client = factory.CreateClient();

        (await GetAsync(client, "ok", forwardedFor: "203.0.113.7")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await GetAsync(client, "ok", forwardedFor: "198.51.100.20")).StatusCode.ShouldBe(HttpStatusCode.NoContent, "another client, another budget");
        (await GetAsync(client, "ok", forwardedFor: "203.0.113.7")).StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);

        (await ActorAsync(client, forwardedFor: "192.0.2.44")).ShouldBe("anonymous:192.0.2.44");
    }

    [Fact]
    public async Task Forwarded_headers_are_ignored_from_an_untrusted_peer_and_when_disabled()
    {
        await using (var untrusted = BehindIngress(forwardedHeaders: true, knownProxy: "10.0.0.1"))
        {
            using var client = untrusted.CreateClient();
            (await ActorAsync(client, forwardedFor: "203.0.113.7")).ShouldBe("anonymous:127.0.0.1");
        }

        await using var disabled = BehindIngress(forwardedHeaders: false, knownProxy: "127.0.0.1");
        using var disabledClient = disabled.CreateClient();
        (await ActorAsync(disabledClient, forwardedFor: "203.0.113.7")).ShouldBe("anonymous:127.0.0.1");
    }

    [Fact]
    public async Task Cors_allows_only_configured_origins()
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder.UseSetting("Security:AllowedOrigins:0", "https://board.example"));
        using var client = factory.CreateClient();

        using (var preflight = await PreflightAsync(client, "https://board.example"))
        {
            AllowOrigin(preflight).ShouldBe("https://board.example");
        }

        using (var preflight = await PreflightAsync(client, "https://evil.example"))
        {
            AllowOrigin(preflight).ShouldBeNull();
        }

        using (var get = await GetWithOriginAsync(client, "https://board.example"))
        {
            get.StatusCode.ShouldBe(HttpStatusCode.NoContent);
            AllowOrigin(get).ShouldBe("https://board.example");
            string.Join(",", get.Headers.GetValues("Access-Control-Expose-Headers")).ShouldContain("Location");
        }

        using (var get = await GetWithOriginAsync(client, "https://evil.example"))
        {
            AllowOrigin(get).ShouldBeNull();
        }

        // Default configuration (no origins): default-deny.
        using var defaultClient = _factory.CreateClient();
        using var denied = await PreflightAsync(defaultClient, "https://board.example");
        AllowOrigin(denied).ShouldBeNull();
    }

    [Theory]
    [InlineData("UAT", HttpStatusCode.OK)]
    [InlineData("Production", HttpStatusCode.NotFound)]
    public async Task OpenApi_and_Scalar_are_mapped_everywhere_but_production(string environment, HttpStatusCode expected)
    {
        // Also boots the environment's appsettings file through options validation, with the ingress network the platform supplies.
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseEnvironment(environment)
            .UseSetting("Security:ForwardedHeaders:KnownNetworks:0", "10.0.0.0/24"));
        using var client = factory.CreateClient();

        (await client.GetAsync("/openapi/v1.json", Ct)).StatusCode.ShouldBe(expected);
        (await client.GetAsync("/scalar/v1", Ct)).StatusCode.ShouldBe(expected);
        (await client.GetAsync("/api/v1/__throw?kind=ok", Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound, "the probe exists only in SystemTest");
    }

    [Theory]
    [InlineData("UAT", true)]
    [InlineData("Production", true)]
    [InlineData("Development", false)]
    [InlineData("SystemTest", false)]
    [InlineData("Demo", false)]
    public async Task Hsts_is_present_on_https_non_loopback_responses_only_in_deployment_environments(string environment, bool expected)
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseEnvironment(environment)
            .UseSetting("Security:ForwardedHeaders:KnownNetworks:0", "10.0.0.0/24"));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://scheduler.example"), // HSTS intentionally excludes loopback hosts
            AllowAutoRedirect = false,
        });

        using var response = await client.GetAsync("/alive", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.Contains("Strict-Transport-Security").ShouldBe(expected);
        if (expected)
        {
            response.Headers.GetValues("Strict-Transport-Security").ShouldBe(["max-age=2592000"]);
        }
    }

    [Theory]
    [InlineData("UAT")]
    [InlineData("Production")]
    public void Forwarded_headers_fail_startup_in_UAT_and_Production_until_the_platform_supplies_the_ingress_addresses(string environment)
    {
        // The environment files enable forwarded headers but ship no trusted addresses: configuration arrays merge by index, so an
        // environment variable meant to replace a shipped default would only overwrite one entry and keep the rest trusted.
        using var factory = _factory.WithWebHostBuilder(builder => builder.UseEnvironment(environment));

        var ex = Should.Throw<Exception>(() => factory.CreateClient());

        var validation = Find<OptionsValidationException>(ex).ShouldNotBeNull(ex.ToString());
        validation.OptionsType.ShouldBe(typeof(SecurityOptions));
        validation.Message.ShouldContain("ForwardedHeaders is enabled without KnownProxies or KnownNetworks");
        validation.Message.ShouldContain("Security__ForwardedHeaders__KnownNetworks__0", Case.Sensitive, "the message says how to fix it");
    }

    [Fact]
    public void Startup_validation_failure_is_logged_as_critical_1103_before_the_host_stops()
    {
        var logs = new CapturingLoggerProvider();
        using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Scheduling:SlotGranularityMinutes", "90")
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));

        Should.Throw<Exception>(() => factory.CreateClient());

        // A structured record (JSON console, OTLP) of why the process is about to die, not only the crash text on stderr.
        var entry = logs.Entries.Where(e => e.EventId.Id == 1103).ShouldHaveSingleItem();
        entry.EventId.Name.ShouldBe("StartupValidationFailed");
        entry.Level.ShouldBe(LogLevel.Critical);
        entry.Message.ShouldContain("SchedulingOptions");
        entry.Message.ShouldContain("SlotGranularityMinutes: The field SchedulingOptions.SlotGranularityMinutes must be between 5 and 60.");
    }

    [Fact]
    public void Unconvertible_configuration_value_fails_startup_and_is_logged_as_critical_1104_without_the_value()
    {
        // The configuration binder throws InvalidOperationException, not OptionsValidationException, for a value it cannot convert.
        var logs = new CapturingLoggerProvider();
        using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Scheduling:SlotGranularityMinutes", "abc")
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));

        var ex = Should.Throw<Exception>(() => factory.CreateClient());

        Find<InvalidOperationException>(ex).ShouldNotBeNull(ex.ToString()).Message.ShouldContain("Scheduling:SlotGranularityMinutes");
        var entry = logs.Entries.Where(e => e.EventId.Id == 1104).ShouldHaveSingleItem();
        entry.EventId.Name.ShouldBe("StartupConfigurationFailed");
        entry.Level.ShouldBe(LogLevel.Critical);
        entry.Message.ShouldContain("System.InvalidOperationException");
        entry.Message.ShouldContain("Failed to convert the configuration value at 'Scheduling:SlotGranularityMinutes' to type 'System.Int32'.");
        entry.Message.ShouldNotContain("abc", Case.Sensitive, "the unconvertible value could be a misplaced secret");
        logs.Entries.ShouldNotContain(e => e.EventId.Id == 1103);
    }

    [Theory]
    [InlineData("Security:AllowedOrigins:0")]
    [InlineData("Scheduling:SlotGranularityMinutes")]
    public void Invalid_startup_setting_is_absent_from_structured_log_state_and_exception(string key)
    {
        const string secret = "Password=boot-secret-sentinel";
        var logs = new CapturingLoggerProvider();
        using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting(key, secret)
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));

        var failure = Should.Throw<Exception>(() => factory.CreateClient());

        var entry = logs.Entries.Where(e => e.EventId.Id is 1103 or 1104).ShouldHaveSingleItem();
        entry.Message.ShouldNotContain(secret);
        foreach (var property in entry.State)
        {
            (property.Value?.ToString() ?? "").ShouldNotContain(secret);
        }
        entry.Exception.ShouldBeNull("an inner exception can repeat a configuration value");
        if (key.StartsWith("Scheduling", StringComparison.Ordinal))
        {
            var conversion = Find<InvalidOperationException>(failure).ShouldNotBeNull();
            var innerText = conversion.InnerException.ShouldNotBeNull().Message;
            entry.Message.ShouldNotContain(innerText);
            entry.State.Any(property => property.Value?.ToString()?.Contains(innerText, StringComparison.Ordinal) == true).ShouldBeFalse();
        }
    }

    private WebApplicationFactory<Program> BehindIngress(bool forwardedHeaders, string knownProxy, int? globalPermitsPerMinute = null) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Security:ForwardedHeaders:Enabled", forwardedHeaders ? "true" : "false");
            builder.UseSetting("Security:ForwardedHeaders:KnownProxies:0", knownProxy);
            if (globalPermitsPerMinute is { } permits)
            {
                builder.UseSetting("Security:RateLimiting:Enabled", "true");
                builder.UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", permits.ToString(CultureInfo.InvariantCulture));
            }

            builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter>(new SimulatedIngress(IPAddress.Loopback)));
        });

    private static async Task<HttpResponseMessage> GetAsync(HttpClient client, string kind, string forwardedFor)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/__throw?kind={kind}");
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        request.Headers.Add("X-Forwarded-Proto", "https");
        return await client.SendAsync(request, Ct);
    }

    private static async Task<string?> ActorAsync(HttpClient client, string forwardedFor)
    {
        using var response = await GetAsync(client, "actor", forwardedFor);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        return body.RootElement.GetString();
    }

    private static async Task<HttpResponseMessage> PreflightAsync(HttpClient client, string origin)
    {
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/__throw?kind=ok");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        return await client.SendAsync(request, Ct);
    }

    private static async Task<HttpResponseMessage> GetWithOriginAsync(HttpClient client, string origin)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/__throw?kind=ok");
        request.Headers.Add("Origin", origin);
        return await client.SendAsync(request, Ct);
    }

    private static string? AllowOrigin(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) ? string.Join(",", values) : null;

    private static T? Find<T>(Exception? exception) where T : Exception
    {
        for (; exception is not null; exception = exception.InnerException)
        {
            if (exception is T match)
            {
                return match;
            }

            if (exception is AggregateException aggregate)
            {
                return aggregate.InnerExceptions.Select(Find<T>).FirstOrDefault(found => found is not null);
            }
        }

        return null;
    }

    private sealed record NotRegistered(string Value);
}

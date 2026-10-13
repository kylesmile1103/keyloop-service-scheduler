using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Environment-wide rendering switches, identical for every caller and bounded by HTTP caching.</summary>
public sealed class FeaturesEndpointTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData(false, "Anonymous")]
    [InlineData(true, "Anonymous")]
    [InlineData(false, "Unknown")]
    [InlineData(true, "Unknown")]
    [InlineData(false, "Viewer")]
    [InlineData(true, "Viewer")]
    [InlineData(false, "ServiceAdvisor")]
    [InlineData(true, "ServiceAdvisor")]
    [InlineData(false, "Admin")]
    [InlineData(true, "Admin")]
    public async Task Returns_only_the_configured_switch_with_public_cache_headers_for_every_caller(bool enabled, string role)
    {
        await using var host = Configured(enabled);
        using var client = Client(host, role);
        using var response = await client.GetAsync("/api/v1/features", Ct);

        await AssertSwitchAsync(response, enabled);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/json");
        response.Headers.NonValidated["Cache-Control"].ShouldHaveSingleItem().ShouldBe("public, max-age=60, must-revalidate");
        response.Headers.CacheControl!.Public.ShouldBeTrue();
        response.Headers.CacheControl.MaxAge.ShouldBe(TimeSpan.FromSeconds(60));
        response.Headers.CacheControl.MustRevalidate.ShouldBeTrue();
        response.Headers.CacheControl.NoStore.ShouldBeFalse();
        response.Headers.Contains("Set-Cookie").ShouldBeFalse();
        response.Headers.Vary.ShouldBeEmpty();
        response.Headers.GetValues("X-Content-Type-Options").ShouldHaveSingleItem().ShouldBe("nosniff");
        Guid.TryParse(response.Headers.GetValues("X-Request-Id").ShouldHaveSingleItem(), out _).ShouldBeTrue();
    }

    [Fact]
    public async Task Default_environment_keeps_vehicle_aware_requirements_disabled()
    {
        using var client = Client(_factory, "Anonymous");
        using var response = await client.GetAsync("/api/v1/features", Ct);
        await AssertSwitchAsync(response, false);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Configuration_reload_keeps_the_effective_switch_until_the_host_restarts(bool enabled)
    {
        await using var host = Configured(enabled);
        using var client = Client(host, "Anonymous");
        using var before = await client.GetAsync("/api/v1/features", Ct);
        await AssertSwitchAsync(before, enabled);

        var configuration = (IConfigurationRoot)host.Services.GetRequiredService<IConfiguration>();
        configuration["Scheduling:VehicleAwareRequirements"] = enabled ? "false" : "true";
        configuration.Reload();

        using var after = await client.GetAsync("/api/v1/features", Ct);
        await AssertSwitchAsync(after, enabled);

        await using var restarted = Configured(!enabled);
        using var restartedClient = Client(restarted, "Anonymous");
        using var restartedResponse = await restartedClient.GetAsync("/api/v1/features", Ct);
        await AssertSwitchAsync(restartedResponse, !enabled);
    }

    [Fact]
    public async Task Global_public_read_rate_limit_returns_an_uncacheable_problem()
    {
        await using var host = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "1"));
        using var client = Client(host, "Anonymous");
        using var first = await client.GetAsync("/api/v1/features", Ct);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var limited = await client.GetAsync("/api/v1/features", Ct);

        limited.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        limited.Headers.CacheControl!.NoStore.ShouldBeTrue();
        limited.Headers.CacheControl.Public.ShouldBeFalse();
        limited.Headers.RetryAfter.ShouldNotBeNull();
        limited.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        using var body = JsonDocument.Parse(await limited.Content.ReadAsStringAsync(Ct));
        body.RootElement.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/rate-limited");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Configuration_reload_before_the_first_read_keeps_the_startup_switch(bool enabled)
    {
        await using var host = Configured(enabled);
        var configuration = (IConfigurationRoot)host.Services.GetRequiredService<IConfiguration>();
        configuration["Scheduling:VehicleAwareRequirements"] = enabled ? "false" : "true";
        configuration.Reload();

        using var client = Client(host, "Anonymous");
        using var response = await client.GetAsync("/api/v1/features", Ct);
        await AssertSwitchAsync(response, enabled);
    }

    [Fact]
    public async Task Wrong_method_remains_uncacheable()
    {
        using var client = Client(_factory, "Anonymous");
        using var response = await client.PostAsync("/api/v1/features", null, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.MethodNotAllowed);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    [Theory]
    [InlineData("/api/v1/me")]
    [InlineData("/api/v1/dealerships")]
    public async Task Other_public_reads_keep_no_store(string route)
    {
        using var client = Client(_factory, "Anonymous");
        using var response = await client.GetAsync(route, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    private WebApplicationFactory<Program> Configured(bool enabled) => _factory.WithWebHostBuilder(builder => builder
        .UseSetting("Scheduling:VehicleAwareRequirements", enabled ? "true" : "false")
        .UseSetting("Scheduling:SlotGranularityMinutes", "30")
        .UseSetting("Scheduling:SuggestedSlotCount", "7")
        .UseSetting("Demo:ReseedKey", "test-private-reseed-key-1234567890"));

    private static HttpClient Client(WebApplicationFactory<Program> host, string role)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        if (role != "Anonymous")
        {
            client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        }

        return client;
    }

    private static async Task AssertSwitchAsync(HttpResponseMessage response, bool enabled)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync(Ct)).ShouldBe(enabled
            ? """{"vehicleAwareRequirements":true}"""
            : """{"vehicleAwareRequirements":false}""");
    }
}

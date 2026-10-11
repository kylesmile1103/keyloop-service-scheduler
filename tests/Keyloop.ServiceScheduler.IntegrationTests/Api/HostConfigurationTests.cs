using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

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
    }

    [Fact]
    public void Invalid_scheduling_configuration_fails_startup()
    {
        using var factory = _factory.WithWebHostBuilder(builder => builder.UseSetting("Scheduling:SlotGranularityMinutes", "90"));

        var ex = Should.Throw<Exception>(() => factory.CreateClient());

        var validation = Find<OptionsValidationException>(ex).ShouldNotBeNull(ex.ToString());
        validation.OptionsType.Name.ShouldBe("SchedulingOptions");
        validation.Message.ShouldContain("SlotGranularityMinutes");
    }

    [Fact]
    public async Task Rate_limited_request_gets_a_429_problem_with_retry_after()
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "1"));
        using var client = factory.CreateClient();

        using var allowed = await client.GetAsync("/api/v1/__throw?kind=ok", Ct);
        allowed.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        using var limited = await client.GetAsync("/api/v1/__throw?kind=ok", Ct);
        limited.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        limited.Content.Headers.ContentType?.MediaType.ShouldBe("application/problem+json");
        using var body = JsonDocument.Parse(await limited.Content.ReadAsStringAsync(Ct));
        var problem = body.RootElement;
        problem.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/rate-limited");
        problem.GetProperty("title").GetString().ShouldBe("Too many requests");
        problem.GetProperty("status").GetInt32().ShouldBe(429);
        problem.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        var retryAfterSeconds = problem.GetProperty("retryAfterSeconds").GetInt32();
        retryAfterSeconds.ShouldBeInRange(1, 60);
        limited.Headers.RetryAfter?.Delta.ShouldBe(TimeSpan.FromSeconds(retryAfterSeconds));
        limited.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);

        using var probe = await client.GetAsync("/alive", Ct);
        probe.StatusCode.ShouldBe(HttpStatusCode.OK, "health probes are exempt from rate limiting");
    }

    [Theory]
    [InlineData("UAT", HttpStatusCode.OK)]
    [InlineData("Production", HttpStatusCode.NotFound)]
    public async Task OpenApi_and_Scalar_are_mapped_everywhere_but_production(string environment, HttpStatusCode expected)
    {
        // Also boots the environment's appsettings file through options validation.
        await using var factory = _factory.WithWebHostBuilder(builder => builder.UseEnvironment(environment));
        using var client = factory.CreateClient();

        (await client.GetAsync("/openapi/v1.json", Ct)).StatusCode.ShouldBe(expected);
        (await client.GetAsync("/scalar/v1", Ct)).StatusCode.ShouldBe(expected);
        (await client.GetAsync("/api/v1/__throw?kind=ok", Ct)).StatusCode.ShouldBe(HttpStatusCode.NotFound, "the probe exists only in SystemTest");
    }

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

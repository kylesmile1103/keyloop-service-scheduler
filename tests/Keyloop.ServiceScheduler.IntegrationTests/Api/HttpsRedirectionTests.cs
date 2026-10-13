using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class HttpsRedirectionTests(PostgresFixture pg)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("Development")]
    [InlineData("SystemTest")]
    [InlineData("Demo")]
    [InlineData("UAT")]
    [InlineData("Production")]
    public async Task Default_http_flow_does_not_redirect_or_log_an_unknown_https_port(string environment)
    {
        using var logs = new CapturingLoggerProvider();
        await using var root = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await using var factory = root.WithWebHostBuilder(builder => Configure(builder, environment, logs));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        var policy = factory.Services.GetRequiredService<IOptions<SecurityOptions>>().Value.HttpsRedirection;
        policy.Enabled.ShouldBeFalse();
        policy.HttpsPort.ShouldBeNull();
        using var response = await client.GetAsync("/alive", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.Location.ShouldBeNull();
        logs.Entries.ShouldNotContain(entry => entry.Category == "Microsoft.AspNetCore.HttpsPolicy.HttpsRedirectionMiddleware"
            && entry.Level >= LogLevel.Warning);
    }

    [Theory]
    [InlineData("Development", 7180)]
    [InlineData("SystemTest", 7443)]
    [InlineData("Demo", 7443)]
    [InlineData("UAT", 443)]
    [InlineData("Production", 443)]
    public async Task Explicit_redirection_preserves_path_and_query_and_accepts_https(string environment, int port)
    {
        using var logs = new CapturingLoggerProvider();
        await using var root = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await using var factory = root.WithWebHostBuilder(builder =>
        {
            Configure(builder, environment, logs);
            builder.UseSetting("Security:HttpsRedirection:Enabled", "true")
                .UseSetting("Security:HttpsRedirection:HttpsPort", port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("http://scheduler.example:5180"), AllowAutoRedirect = false,
        });
        using var response = await client.GetAsync("/alive?check=1", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.TemporaryRedirect);
        response.Headers.Location.ShouldBe(new UriBuilder("https", "scheduler.example", port, "/alive", "?check=1").Uri);
        using var secure = await client.GetAsync(response.Headers.Location, Ct);
        secure.StatusCode.ShouldBe(HttpStatusCode.OK);
        secure.Headers.Location.ShouldBeNull();
        logs.Entries.ShouldNotContain(entry => entry.Category == "Microsoft.AspNetCore.HttpsPolicy.HttpsRedirectionMiddleware"
            && entry.Level >= LogLevel.Warning);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("SystemTest")]
    [InlineData("Demo")]
    [InlineData("UAT")]
    [InlineData("Production")]
    public void Enabled_redirection_without_a_port_fails_at_startup(string environment)
    {
        using var logs = new CapturingLoggerProvider();
        using var root = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        using var factory = root.WithWebHostBuilder(builder =>
        {
            Configure(builder, environment, logs);
            builder.UseSetting("Security:HttpsRedirection:Enabled", "true");
        });
        var error = Should.Throw<Exception>(() => factory.CreateClient());
        error.ToString().ShouldContain("HttpsRedirection is enabled without HttpsPort");
        logs.Entries.ShouldContain(entry => entry.EventId.Id == 1103 && entry.Level == LogLevel.Critical);
    }

    [Theory]
    [InlineData("UAT")]
    [InlineData("Production")]
    public async Task Trusted_tls_termination_does_not_redirect_and_keeps_hsts(string environment)
    {
        using var logs = new CapturingLoggerProvider();
        await using var root = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await using var factory = root.WithWebHostBuilder(builder =>
        {
            Configure(builder, environment, logs);
            builder.UseSetting("Security:HttpsRedirection:Enabled", "true")
                .UseSetting("Security:HttpsRedirection:HttpsPort", "443");
            builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter>(
                new SimulatedIngress(IPAddress.Parse("10.0.0.7"))));
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("http://scheduler.example"), AllowAutoRedirect = false,
        });
        using var request = new HttpRequestMessage(HttpMethod.Get, "/alive");
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Add("X-Forwarded-For", "192.0.2.1");
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.GetValues("Strict-Transport-Security").ShouldBe(["max-age=2592000"]);
        response.Headers.Location.ShouldBeNull();
    }

    private static void Configure(IWebHostBuilder builder, string environment, CapturingLoggerProvider logs) => builder
        .UseEnvironment(environment)
        .UseSetting("Security:ForwardedHeaders:KnownNetworks:0", "10.0.0.0/24")
        .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs));
}

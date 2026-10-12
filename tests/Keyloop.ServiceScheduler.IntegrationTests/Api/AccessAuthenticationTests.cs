using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Only locally signed tokens and stubbed JWKS. No Access account or real token is used.</summary>
public sealed class AccessAuthenticationTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private readonly RSA _rsa = RSA.Create(2048);
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private const string Team = "https://integration.cloudflareaccess.com";

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
    }
    public async ValueTask DisposeAsync()
    {
        await _factory.DisposeAsync();
        _rsa.Dispose();
    }

    [Theory]
    [InlineData("header", true)]
    [InlineData("cookie", true)]
    [InlineData("bearer", false)]
    [InlineData("invalid-header-valid-cookie", false)]
    [InlineData("multiple-headers", false)]
    // HttpClient omits a header whose only value is empty; this exercises the absent-header cookie fallback.
    [InlineData("empty-header-valid-cookie", true)]
    [InlineData("test-header", false)]
    public async Task Real_handler_validates_header_or_cookie_and_does_not_trust_other_identity_hints(string transport, bool authenticated)
    {
        var jwks = new StubKeys(Jwks());
        using var host = AccessHost(jwks);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Clear();
        var token = Token();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        if (transport == "header")
        {
            request.Headers.Add("Cf-Access-Jwt-Assertion", token);
        }

        if (transport is "cookie" or "invalid-header-valid-cookie" or "empty-header-valid-cookie")
        {
            request.Headers.Add("Cookie", $"CF_Authorization={token}");
        }

        if (transport == "invalid-header-valid-cookie")
        {
            request.Headers.Add("Cf-Access-Jwt-Assertion", "invalid-token");
        }

        if (transport == "empty-header-valid-cookie")
        {
            request.Headers.Add("Cf-Access-Jwt-Assertion", "");
        }

        if (transport == "multiple-headers")
        {
            request.Headers.Add("Cf-Access-Jwt-Assertion", new[] { token, token });
        }

        if (transport == "bearer")
        {
            request.Headers.Authorization = new("Bearer", token);
        }

        if (transport == "test-header")
        {
            request.Headers.Add(TestAuthenticationHandler.Header, "Admin");
        }

        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        body.RootElement.GetProperty("authenticated").GetBoolean().ShouldBe(authenticated);
        body.RootElement.GetProperty("roles").EnumerateArray().Select(item => item.GetString()).ShouldBe(authenticated ? ["ServiceAdvisor"] : []);
        jwks.Calls.ShouldBe(authenticated ? 1 : 0);
    }

    [Fact]
    public async Task An_empty_assertion_actually_present_at_the_server_does_not_fall_back_to_a_cookie()
    {
        var keys = new StubKeys(Jwks());
        using var host = AccessHost(keys);
        var response = await host.Server.SendAsync(http =>
        {
            http.Request.Method = "GET";
            http.Request.Path = "/api/v1/appointments/11111111-1111-1111-1111-111111111111";
            http.Request.Headers["Cf-Access-Jwt-Assertion"] = "";
            http.Request.Headers.Cookie = $"CF_Authorization={Token()}";
        }, Ct);
        response.Response.StatusCode.ShouldBe(401);
        keys.Calls.ShouldBe(0);
    }

    [Theory]
    [InlineData("Admin", true, 404)]
    [InlineData("Viewer", true, 404)]
    [InlineData("", false, 401)]
    public async Task Development_mode_uses_only_the_configured_roles_and_empty_roles_are_anonymous(string role, bool authenticated, int status)
    {
        using var host = _factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development")
            .UseSetting("Auth:Mode", "Development").UseSetting("Auth:Development:Roles:0", role)
            .UseSetting("Auth:Development:Email", "developer@keyloop.test")
            .UseSetting("Notifications:Enabled", "false").UseSetting("Notifications:Provider", "None")
            .ConfigureTestServices(services => services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = SchedulerAuthentication.Scheme;
                options.DefaultChallengeScheme = SchedulerAuthentication.Scheme;
            })));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Clear();
        using var me = JsonDocument.Parse(await client.GetStringAsync("/api/v1/me", Ct));
        me.RootElement.GetProperty("authenticated").GetBoolean().ShouldBe(authenticated);
        me.RootElement.GetProperty("email").GetString().ShouldBe(authenticated ? "developer@keyloop.test" : null);
        me.RootElement.GetProperty("roles").EnumerateArray().Select(item => item.GetString()).ShouldBe(authenticated ? new[] { role } : []);
        using var details = await client.GetAsync("/api/v1/appointments/11111111-1111-1111-1111-111111111111", Ct);
        ((int)details.StatusCode).ShouldBe(status);
    }

    [Theory]
    [InlineData("viewer@keyloop.test", 404)]
    [InlineData("unknown@keyloop.test", 403)]
    public async Task Signed_token_roles_cannot_elevate_the_email_mapping(string email, int status)
    {
        using var host = AccessHost(new StubKeys(Jwks()));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Clear();
        client.DefaultRequestHeaders.Add("Cf-Access-Jwt-Assertion", Token(email));
        using var response = await client.GetAsync("/api/v1/appointments/11111111-1111-1111-1111-111111111111", Ct);
        ((int)response.StatusCode).ShouldBe(status);
        using var post = await client.PostAsync("/api/v1/dealerships/11111111-1111-1111-1111-111111111111/appointments", null, Ct);
        post.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("outage")]
    [InlineData("malformed")]
    [InlineData("oversize")]
    public async Task Jwks_failures_deny_writes_without_logging_token_or_email(string failure)
    {
        var token = Token();
        var logs = new CapturingLoggerProvider();
        var keys = new StubKeys(failure == "malformed" ? "{}" : failure == "oversize" ? new string('x', 70 * 1024) : Jwks(),
            failure == "outage" ? $"{token} advisor@keyloop.test" : null);
        using var host = AccessHost(keys, logs);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Clear();
        client.DefaultRequestHeaders.Add("Cf-Access-Jwt-Assertion", token);
        for (var i = 0; i < 2; i++)
        {
            using var response = await client.PostAsync("/api/v1/dealerships/11111111-1111-1111-1111-111111111111/appointments", null, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        }
        keys.Calls.ShouldBe(1, "failures use the same refresh floor as random-kid attacks");
        logs.Entries.Where(entry => entry.Level > LogLevel.Debug)
            .ShouldNotContain(entry => entry.Message.Contains(token, StringComparison.Ordinal)
                || entry.Message.Contains("advisor@keyloop.test", StringComparison.Ordinal)
                || (entry.Exception != null && entry.Exception.ToString().Contains(token, StringComparison.Ordinal)));
    }

    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> AccessHost(StubKeys keys, CapturingLoggerProvider? logs = null) =>
        _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Auth:Mode", "CloudflareAccess").UseSetting("Auth:TeamDomain", Team).UseSetting("Auth:Audience:0", "aud-test")
            .UseSetting("Auth:Roles:ServiceAdvisor:0", "advisor@keyloop.test").UseSetting("Auth:Roles:Viewer:0", "viewer@keyloop.test")
            .ConfigureTestServices(services =>
            {
                services.PostConfigure<AuthenticationOptions>(options =>
                {
                    options.DefaultAuthenticateScheme = SchedulerAuthentication.Scheme;
                    options.DefaultChallengeScheme = SchedulerAuthentication.Scheme;
                    options.DefaultForbidScheme = SchedulerAuthentication.Scheme;
                });
                services.AddHttpClient("AccessJwks").ConfigurePrimaryHttpMessageHandler(() => keys);
                if (logs is not null)
                {
                    services.AddSingleton<ILoggerProvider>(logs);
                }
            }));

    private string Token(string email = "advisor@keyloop.test")
    {
        var now = _factory.Clock.GetUtcNow().ToUnixTimeSeconds();
        var header = new JsonObject { ["alg"] = "RS256", ["kid"] = "integration-key" };
        var payload = new JsonObject
        {
            ["iss"] = Team, ["aud"] = new JsonArray("aud-test"), ["exp"] = now + 300, ["nbf"] = now - 1,
            ["email"] = email, ["name"] = "Integration Advisor", ["sub"] = "local-user", ["roles"] = new JsonArray("Admin"),
        };
        var input = $"{Base64UrlEncoder.Encode(header.ToJsonString())}.{Base64UrlEncoder.Encode(payload.ToJsonString())}";
        return $"{input}.{Base64UrlEncoder.Encode(_rsa.SignData(System.Text.Encoding.UTF8.GetBytes(input), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))}";
    }

    private string Jwks()
    {
        var key = _rsa.ExportParameters(false);
        return new JsonObject { ["keys"] = new JsonArray(new JsonObject
        {
            ["kty"] = "RSA", ["kid"] = "integration-key", ["n"] = Base64UrlEncoder.Encode(key.Modulus!), ["e"] = Base64UrlEncoder.Encode(key.Exponent!),
        }) }.ToJsonString();
    }

    private sealed class StubKeys(string body, string? failure = null) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.RequestUri!.AbsoluteUri.ShouldBe($"{Team}/cdn-cgi/access/certs");
            Calls++;
            if (failure is not null)
            {
                throw new HttpRequestException(failure);
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
        }
    }
}

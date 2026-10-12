using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Microsoft.IdentityModel.Tokens;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

public sealed class AccessTokenTests : IDisposable
{
    private readonly RSA _rsa = RSA.Create(2048);
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero));
    private readonly AuthOptions _settings = new() { TeamDomain = "https://unit.cloudflareaccess.com", Audience = ["aud-one", "aud-two"] };
    public void Dispose() => _rsa.Dispose();

    [Theory]
    [InlineData("valid", true)]
    [InlineData("second-audience", true)]
    [InlineData("wrong-issuer", false)]
    [InlineData("wrong-audience", false)]
    [InlineData("expired", false)]
    [InlineData("not-yet-valid", false)]
    [InlineData("no-expiry", false)]
    [InlineData("nbf-after-exp", false)]
    [InlineData("unsigned", false)]
    [InlineData("hs256", false)]
    [InlineData("tampered", false)]
    [InlineData("no-email", false)]
    [InlineData("no-kid", false)]
    [InlineData("unknown-kid", false)]
    [InlineData("malformed", false)]
    public async Task Validates_signature_issuer_audience_lifetime_and_human_identity(string variant, bool accepted)
    {
        using var transport = new JwksHandler(Jwks("key-one"));
        using var client = new HttpClient(transport);
        using var keys = new AccessSigningKeys(client, Options.Create(_settings), _clock);
        var validator = new AccessTokenValidator(keys, Options.Create(_settings), _clock);
        var identity = await validator.ValidateAsync(Token(variant), TestContext.Current.CancellationToken);
        (identity is not null).ShouldBe(accepted);
        if (identity is not null)
        {
            identity.FindFirst(ClaimTypes.Email)!.Value.ShouldBe("advisor@keyloop.test");
            identity.FindAll(ClaimTypes.Role).ShouldBeEmpty("roles supplied by the JWT must never grant API roles");
        }
    }

    [Fact]
    public async Task Caches_keys_refreshes_unknown_kid_and_accepts_overlap_until_refresh_removes_old_key()
    {
        using var transport = new JwksHandler(Jwks("key-one"));
        using var client = new HttpClient(transport);
        using var keys = new AccessSigningKeys(client, Options.Create(_settings), _clock);
        var validator = new AccessTokenValidator(keys, Options.Create(_settings), _clock);
        var ct = TestContext.Current.CancellationToken;
        (await validator.ValidateAsync(Token("valid"), ct)).ShouldNotBeNull();
        (await validator.ValidateAsync(Token("valid"), ct)).ShouldNotBeNull();
        transport.Calls.ShouldBe(1);
        transport.Body = Jwks("key-one", "key-two");
        _clock.Advance(TimeSpan.FromSeconds(31));
        (await validator.ValidateAsync(Token("valid", "key-two"), ct)).ShouldNotBeNull();
        (await validator.ValidateAsync(Token("valid"), ct)).ShouldNotBeNull();
        transport.Calls.ShouldBe(2);
        transport.Body = Jwks("key-two");
        _clock.Advance(TimeSpan.FromHours(1));
        (await validator.ValidateAsync(Token("valid", "key-two"), ct)).ShouldNotBeNull();
        (await validator.ValidateAsync(Token("valid"), ct)).ShouldBeNull();
        transport.Calls.ShouldBe(3);
        transport.LastUrl.ShouldBe("https://unit.cloudflareaccess.com/cdn-cgi/access/certs");
    }

    [Fact]
    public async Task Unknown_kid_flood_is_bounded_and_cache_refresh_is_single_flight()
    {
        using var transport = new JwksHandler(Jwks("key-one"));
        using var client = new HttpClient(transport);
        using var keys = new AccessSigningKeys(client, Options.Create(_settings), _clock);
        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => keys.GetAsync($"unknown-{i}", TestContext.Current.CancellationToken)));
        transport.Calls.ShouldBe(1);
    }

    [Fact]
    public async Task Expired_key_cache_is_not_used_when_refresh_fails()
    {
        using var transport = new JwksHandler(Jwks("key-one"));
        using var client = new HttpClient(transport);
        using var keys = new AccessSigningKeys(client, Options.Create(_settings), _clock);
        await keys.GetAsync("key-one", TestContext.Current.CancellationToken);
        _clock.Advance(TimeSpan.FromHours(1));
        transport.Body = "{}";
        await Should.ThrowAsync<InvalidOperationException>(() => keys.GetAsync("key-one", TestContext.Current.CancellationToken));
        await Should.ThrowAsync<InvalidOperationException>(() => keys.GetAsync("key-one", TestContext.Current.CancellationToken));
        transport.Calls.ShouldBe(2);
    }

    internal string Token(string variant, string kid = "key-one")
    {
        if (variant == "malformed")
        {
            return "not.a.jwt";
        }

        var now = _clock.GetUtcNow().ToUnixTimeSeconds();
        var header = new JsonObject { ["alg"] = variant == "unsigned" ? "none" : variant == "hs256" ? "HS256" : "RS256", ["kid"] = kid };
        if (variant == "no-kid")
        {
            header.Remove("kid");
        }

        if (variant == "unknown-kid")
        {
            header["kid"] = "unknown";
        }

        var payload = new JsonObject
        {
            ["iss"] = variant == "wrong-issuer" ? "https://evil.test" : _settings.TeamDomain,
            ["aud"] = new JsonArray(variant == "wrong-audience" ? "other" : variant == "second-audience" ? "aud-two" : "aud-one"),
            ["exp"] = variant == "expired" ? now - 60 : now + 300,
            ["nbf"] = variant == "not-yet-valid" ? now + 60 : variant == "nbf-after-exp" ? now + 400 : now - 1,
            ["email"] = "advisor@keyloop.test", ["name"] = "Test Advisor", ["sub"] = "unit-user",
            ["roles"] = new JsonArray("Admin"),
        };
        if (variant == "no-email")
        {
            payload.Remove("email");
        }

        if (variant == "no-expiry")
        {
            payload.Remove("exp");
        }

        var signingInput = $"{Base64UrlEncoder.Encode(header.ToJsonString())}.{Base64UrlEncoder.Encode(payload.ToJsonString())}";
        var signature = _rsa.SignData(System.Text.Encoding.UTF8.GetBytes(signingInput), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        if (variant == "tampered")
        {
            signature[0] ^= 1;
        }

        return $"{signingInput}.{(variant == "unsigned" ? "" : Base64UrlEncoder.Encode(signature))}";
    }

    private string Jwks(params string[] kids)
    {
        var parameters = _rsa.ExportParameters(false);
        return new JsonObject { ["keys"] = new JsonArray(kids.Select(kid => (JsonNode)new JsonObject
        {
            ["kty"] = "RSA", ["kid"] = kid, ["n"] = Base64UrlEncoder.Encode(parameters.Modulus!),
            ["e"] = Base64UrlEncoder.Encode(parameters.Exponent!), ["use"] = "sig", ["alg"] = "RS256",
        }).ToArray()) }.ToJsonString();
    }

    private sealed class JwksHandler(string body) : HttpMessageHandler
    {
        public string Body { get; set; } = body;
        public int Calls { get; private set; }
        public string? LastUrl { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            LastUrl = request.RequestUri!.AbsoluteUri;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Body) });
        }
    }
}

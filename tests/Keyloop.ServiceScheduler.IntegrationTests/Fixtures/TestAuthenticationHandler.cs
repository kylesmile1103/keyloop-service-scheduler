using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Test assembly only. No header grants identity in the deployed API.</summary>
public sealed class TestAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "TestIdentity";
    public const string Header = "X-Test-Role";
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var role = Request.Headers[Header].ToString();
        if (string.IsNullOrEmpty(role) || role == "Anonymous")
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var identity = new ClaimsIdentity(SchemeName);
        identity.AddClaim(new Claim(ClaimTypes.Email, Request.Headers["X-Test-Email"].FirstOrDefault() ?? "test-user@keyloop.test"));
        identity.AddClaim(new Claim(ClaimTypes.Name, "Test User"));
        if (role != "Unknown")
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }

        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}

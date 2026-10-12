using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>Microsoft's token validator owns JOSE/signatures. Project only verified human identity claims, never token-supplied roles.</summary>
public sealed class AccessTokenValidator(AccessSigningKeys keys, IOptions<AuthOptions> options, TimeProvider clock)
{
    private readonly JsonWebTokenHandler _handler = new() { MapInboundClaims = false, MaximumTokenSizeInBytes = 16 * 1024 };

    internal async Task<ClaimsIdentity?> ValidateAsync(string token, CancellationToken ct)
    {
        if (!_handler.CanReadToken(token))
        {
            return null;
        }

        JsonWebToken jwt;
        try
        {
            jwt = _handler.ReadJsonWebToken(token);
        }
        catch (ArgumentException)
        {
            return null;
        }
        if (jwt.Alg != SecurityAlgorithms.RsaSha256 || string.IsNullOrWhiteSpace(jwt.Kid))
        {
            return null;
        }

        var settings = options.Value;
        var signingKeys = await keys.GetAsync(jwt.Kid, ct);
        var result = await _handler.ValidateTokenAsync(token, new TokenValidationParameters
        {
            RequireSignedTokens = true, ValidateIssuerSigningKey = true, IssuerSigningKeys = signingKeys,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256], TryAllIssuerSigningKeys = false,
            ValidateIssuer = true, ValidIssuer = settings.TeamDomain,
            ValidateAudience = true, ValidAudiences = settings.Audience,
            ValidateLifetime = true, RequireExpirationTime = true, ClockSkew = settings.ClockSkew,
            // Injected time supports deterministic tests; keep all standard exp/nbf conditions.
            LifetimeValidator = (notBefore, expires, _, _) => expires is { } exp
                && (notBefore is null || notBefore <= exp)
                && exp > clock.GetUtcNow().UtcDateTime.Subtract(settings.ClockSkew)
                && (notBefore is null || notBefore <= clock.GetUtcNow().UtcDateTime.Add(settings.ClockSkew)),
        });
        if (!result.IsValid)
        {
            return null;
        }

        var email = result.ClaimsIdentity.FindFirst("email")?.Value;
        if (email is null || !AuthOptions.ValidEmail(email))
        {
            return null; // no machine/service identities
        }

        var identity = new ClaimsIdentity(SchedulerAuthentication.Scheme, ClaimTypes.Name, ClaimTypes.Role);
        identity.AddClaim(new Claim(ClaimTypes.Email, email));
        var name = result.ClaimsIdentity.FindFirst("name")?.Value;
        if (name is not null)
        {
            identity.AddClaim(new Claim(ClaimTypes.Name, name));
        }

        if (result.ClaimsIdentity.FindFirst("sub") is { } subject)
        {
            identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, subject.Value));
        }

        return identity;
    }
}

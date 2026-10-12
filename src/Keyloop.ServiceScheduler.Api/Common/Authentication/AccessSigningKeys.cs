using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>Bounded source-generated JWKS, cached for an hour and refreshed for unknown kids with a 30-second refresh floor.</summary>
public sealed class AccessSigningKeys(HttpClient client, IOptions<AuthOptions> options, TimeProvider clock) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private SecurityKey[] _keys = [];
    private DateTimeOffset _nextRefresh;
    private DateTimeOffset _expires;

    internal async Task<SecurityKey[]> GetAsync(string kid, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var now = clock.GetUtcNow();
            if (now >= _nextRefresh && (now >= _expires || !_keys.Any(key => key.KeyId == kid)))
            {
                _nextRefresh = now.AddSeconds(30); // also bounds repeated failures and random-kid attacks
                using var response = await client.GetAsync($"{options.Value.TeamDomain}/cdn-cgi/access/certs", ct);
                response.EnsureSuccessStatusCode();
                var document = await response.Content.ReadFromJsonAsync(AccessJsonContext.Default.AccessJwks, ct)
                    ?? throw new InvalidOperationException("Access signing keys unavailable.");
                if (document.Keys is not { Length: > 0 and <= 16 })
                {
                    throw new InvalidOperationException("Access signing keys unavailable.");
                }

                var keys = document.Keys.Where(key => key is not null && !string.IsNullOrWhiteSpace(key.Kid) && key.Kty == "RSA" && key.Alg is null or "RS256" && key.Use is null or "sig")
                    .Select(key => (SecurityKey)new RsaSecurityKey(new RSAParameters
                    {
                        Modulus = Base64UrlEncoder.DecodeBytes(key.N), Exponent = Base64UrlEncoder.DecodeBytes(key.E),
                    }) { KeyId = key.Kid }).ToArray();
                if (keys.Length == 0 || keys.Length > 16)
                {
                    throw new InvalidOperationException("Access signing keys unavailable.");
                }

                _keys = keys;
                _expires = now.AddHours(1);
            }
            if (now >= _expires)
            {
                throw new InvalidOperationException("Access signing keys unavailable.");
            }
            return _keys;
        }
        finally { _gate.Release(); }
    }

    public void Dispose()
    {
        _gate.Dispose();
        client.Dispose();
    }
}

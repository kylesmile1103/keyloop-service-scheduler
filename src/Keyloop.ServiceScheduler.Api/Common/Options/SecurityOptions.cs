using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>CORS, rate limiting and forwarded headers (SYSTEM_DESIGN §11.2). Validated at startup by <see cref="SecurityOptionsValidator"/>.</summary>
public sealed class SecurityOptions : IValidatableObject
{
    public const string SectionName = "Security";

    /// <summary>
    /// Exact origins allowed by CORS (scheme, host and optional port, e.g. <c>https://board.example</c>). Empty means default-deny
    /// (Development uses the Vite proxy, so it stays same-origin). <c>*</c> is rejected: list the origins.
    /// </summary>
    public string[] AllowedOrigins { get; set; } = [];

    [ValidateObjectMembers]
    public RateLimitingOptions RateLimiting { get; set; } = new();

    [ValidateObjectMembers]
    public ForwardedHeadersSettings ForwardedHeaders { get; set; } = new();

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        foreach (var origin in AllowedOrigins)
        {
            if (!IsExactOrigin(origin))
            {
                yield return new ValidationResult(
                    $"{nameof(AllowedOrigins)} entry '{origin}' is not an exact http(s) origin such as https://board.example ('*' is not allowed).",
                    [nameof(AllowedOrigins)]);
            }
        }
    }

    private static bool IsExactOrigin(string origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && !origin.EndsWith('/');

    /// <summary>Sliding-window limits per client IP; <see cref="Enabled"/> is false only in SystemTest.</summary>
    public sealed class RateLimitingOptions
    {
        public bool Enabled { get; set; } = true;

        /// <summary>The <c>global</c> limiter: every request except health probes.</summary>
        [Range(1, 100_000)]
        public int GlobalPermitsPerMinute { get; set; } = 300;

        /// <summary>The <c>booking</c> policy, applied to the booking endpoint on top of the global limiter.</summary>
        [Range(1, 100_000)]
        public int BookingPermitsPerMinute { get; set; } = 30;
    }

    /// <summary>
    /// <c>X-Forwarded-For</c>/<c>X-Forwarded-Proto</c> from a TLS-terminating ingress (UAT, Production), so rate-limit partitions, the
    /// audit actor and HTTPS redirection see the client rather than the ingress. Only the listed peers are trusted, and only the
    /// last hop is taken.
    /// </summary>
    public sealed class ForwardedHeadersSettings : IValidatableObject
    {
        public bool Enabled { get; set; }

        /// <summary>Proxy addresses (e.g. <c>10.1.2.3</c>) whose forwarded headers are trusted.</summary>
        public string[] KnownProxies { get; set; } = [];

        /// <summary>Proxy networks in CIDR notation (e.g. <c>10.0.0.0/8</c>) whose forwarded headers are trusted.</summary>
        public string[] KnownNetworks { get; set; } = [];

        public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
        {
            foreach (var proxy in KnownProxies.Where(proxy => !IPAddress.TryParse(proxy, out _)))
            {
                yield return new ValidationResult($"{nameof(KnownProxies)} entry '{proxy}' is not an IP address.", [nameof(KnownProxies)]);
            }

            foreach (var network in KnownNetworks.Where(network => !System.Net.IPNetwork.TryParse(network, out _)))
            {
                yield return new ValidationResult(
                    $"{nameof(KnownNetworks)} entry '{network}' is not a CIDR network such as 10.0.0.0/8.", [nameof(KnownNetworks)]);
            }

            // With both lists empty the framework skips its peer check and trusts the headers from anyone.
            if (Enabled && KnownProxies.Length == 0 && KnownNetworks.Length == 0)
            {
                yield return new ValidationResult(
                    "ForwardedHeaders is enabled without KnownProxies or KnownNetworks, which would trust X-Forwarded-For from any peer.",
                    [nameof(KnownProxies), nameof(KnownNetworks)]);
            }
        }
    }
}

/// <summary>Generated from the <see cref="SecurityOptions"/> attributes and <see cref="IValidatableObject"/> rules (Addendum A §A4).</summary>
[OptionsValidator]
public sealed partial class SecurityOptionsValidator : IValidateOptions<SecurityOptions>;

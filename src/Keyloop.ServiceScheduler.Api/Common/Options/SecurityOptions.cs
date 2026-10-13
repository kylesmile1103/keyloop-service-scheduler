using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>CORS, rate limiting, HTTPS redirection, and forwarded headers configuration.</summary>
public sealed class SecurityOptions : IValidatableObject
{
    public const string SectionName = "Security";

    /// <summary>Exact origins allowed by CORS (e.g. <c>https://board.example</c>). Empty means default-deny; <c>*</c> is rejected.</summary>
    public string[] AllowedOrigins { get; set; } = [];

    [ValidateObjectMembers]
    public RateLimitingOptions RateLimiting { get; set; } = new();

    [ValidateObjectMembers]
    public ForwardedHeadersSettings ForwardedHeaders { get; set; } = new();

    [ValidateObjectMembers]
    public HttpsRedirectionSettings HttpsRedirection { get; set; } = new();

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        for (var index = 0; index < AllowedOrigins.Length; index++)
        {
            if (!IsExactOrigin(AllowedOrigins[index]))
            {
                yield return new ValidationResult(
                    $"{nameof(AllowedOrigins)}[{index}] is not an exact http(s) origin such as https://board.example ('*' is not allowed).",
                    [nameof(AllowedOrigins)]);
            }
        }
    }

    private static bool IsExactOrigin(string origin) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && !origin.EndsWith('/');

    /// <summary>Explicit opt-in for HTTP-to-HTTPS redirection with a required destination port.</summary>
    public sealed class HttpsRedirectionSettings : IValidatableObject
    {
        public bool Enabled { get; set; }

        [Range(1, 65535)]
        public int? HttpsPort { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
        {
            if (Enabled && HttpsPort is null)
            {
                yield return new ValidationResult(
                    "HttpsRedirection is enabled without HttpsPort. Supply Security__HttpsRedirection__HttpsPort for the reachable HTTPS listener.",
                    [nameof(HttpsPort)]);
            }
        }
    }

    /// <summary>Sliding-window rate limits partitioned by verified email or client IP.</summary>
    public sealed class RateLimitingOptions
    {
        [Range(1, 1000)]
        public int TriagePermitsPerMinute { get; set; } = 10;
        public bool Enabled { get; set; } = true;

        /// <summary>Permits per minute for the global limiter applied to all non-health requests.</summary>
        [Range(1, 100_000)]
        public int GlobalPermitsPerMinute { get; set; } = 300;

        /// <summary>Permits per minute for the stricter write policy shared by booking and cancellation.</summary>
        [Range(1, 100_000)]
        public int BookingPermitsPerMinute { get; set; } = 30;
    }

    /// <summary>
    /// Trusted proxy and network configuration for <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> headers.
    /// When enabled, at least one proxy or network must be specified.
    /// </summary>
    public sealed class ForwardedHeadersSettings : IValidatableObject
    {
        public bool Enabled { get; set; }

        /// <summary>Proxy IP addresses whose forwarded headers are trusted.</summary>
        public string[] KnownProxies { get; set; } = [];

        /// <summary>Proxy networks in CIDR notation (e.g. <c>10.0.0.0/8</c>) whose forwarded headers are trusted.</summary>
        public string[] KnownNetworks { get; set; } = [];

        public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
        {
            for (var index = 0; index < KnownProxies.Length; index++)
            {
                if (!IPAddress.TryParse(KnownProxies[index], out _))
                {
                    yield return new ValidationResult($"{nameof(KnownProxies)}[{index}] is not an IP address.", [nameof(KnownProxies)]);
                }
            }

            for (var index = 0; index < KnownNetworks.Length; index++)
            {
                if (!System.Net.IPNetwork.TryParse(KnownNetworks[index], out _))
                {
                    yield return new ValidationResult(
                        $"{nameof(KnownNetworks)}[{index}] is not a CIDR network such as 10.0.0.0/8.", [nameof(KnownNetworks)]);
                }
            }

            if (Enabled && KnownProxies.Length == 0 && KnownNetworks.Length == 0)
            {
                yield return new ValidationResult(
                    "ForwardedHeaders is enabled without KnownProxies or KnownNetworks, which would trust X-Forwarded-For from any peer. "
                    + "Supply the ingress addresses, e.g. Security__ForwardedHeaders__KnownNetworks__0=10.0.0.0/24.",
                    [nameof(KnownProxies), nameof(KnownNetworks)]);
            }
        }
    }
}

[OptionsValidator]
public sealed partial class SecurityOptionsValidator : IValidateOptions<SecurityOptions>;

using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>CORS, rate limiting and forwarded headers (ARCHITECTURE §11.2). Validated at startup by <see cref="SecurityOptionsValidator"/>.</summary>
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

    /// <summary>Sliding-window limits per client IP; <see cref="Enabled"/> is false only in SystemTest.</summary>
    public sealed class RateLimitingOptions
    {
        [Range(1, 1000)]
        public int TriagePermitsPerMinute { get; set; } = 10;
        public bool Enabled { get; set; } = true;

        /// <summary>The <c>global</c> limiter: every request except health probes.</summary>
        [Range(1, 100_000)]
        public int GlobalPermitsPerMinute { get; set; } = 300;

        /// <summary>The <c>booking</c> policy, the stricter write limit shared by booking and cancellation, on top of the global limiter.</summary>
        [Range(1, 100_000)]
        public int BookingPermitsPerMinute { get; set; } = 30;
    }

    /// <summary>
    /// <c>X-Forwarded-For</c>/<c>X-Forwarded-Proto</c> from an ingress (UAT, Production, nginx in Demo), so rate-limit partitions, the
    /// audit actor and HTTPS redirection see the client rather than the ingress. Only the listed peers are trusted, and only the
    /// last hop is taken.
    /// </summary>
    /// <remarks>
    /// UAT and Production enable it but ship both lists empty, so startup fails until the platform supplies its ingress addresses
    /// (e.g. <c>Security__ForwardedHeaders__KnownNetworks__0</c>). A shipped default would be unsafe to override: configuration
    /// arrays merge by index, so an environment variable for entry 0 replaces only that entry and keeps the rest trusted. Demo is the
    /// exception: it ships the one network that the AppHost creates for its Compose bundle (an AppHost model test keeps the two equal),
    /// and the API stays unpublished there, because that network includes the bridge gateway that carries published host traffic.
    /// </remarks>
    public sealed class ForwardedHeadersSettings : IValidatableObject
    {
        public bool Enabled { get; set; }

        /// <summary>Proxy addresses (e.g. <c>10.1.2.3</c>) whose forwarded headers are trusted.</summary>
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

            // With both lists empty the framework skips its peer check and trusts the headers from anyone.
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

/// <summary>Generated from the <see cref="SecurityOptions"/> attributes and <see cref="IValidatableObject"/> rules (Addendum A §A4).</summary>
[OptionsValidator]
public sealed partial class SecurityOptionsValidator : IValidateOptions<SecurityOptions>;

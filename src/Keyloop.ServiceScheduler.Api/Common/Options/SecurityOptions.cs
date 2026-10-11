using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>CORS and rate limiting (SYSTEM_DESIGN §11.2). Validated at startup by <see cref="SecurityOptionsValidator"/>.</summary>
public sealed class SecurityOptions
{
    public const string SectionName = "Security";

    /// <summary>Origins allowed by CORS. Empty means default-deny (Development uses the Vite proxy, so it stays same-origin).</summary>
    public string[] AllowedOrigins { get; set; } = [];

    [ValidateObjectMembers]
    public RateLimitingOptions RateLimiting { get; set; } = new();

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
}

/// <summary>Generated from the <see cref="SecurityOptions"/> attributes (Addendum A §A4).</summary>
[OptionsValidator]
public sealed partial class SecurityOptionsValidator : IValidateOptions<SecurityOptions>;

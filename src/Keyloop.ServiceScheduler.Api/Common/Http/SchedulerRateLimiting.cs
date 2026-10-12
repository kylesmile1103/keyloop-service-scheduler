using System.Globalization;
using System.Threading.RateLimiting;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Rate limiting per client IP with one-minute sliding windows (ARCHITECTURE §11.2): the <c>global</c> limiter applies to every
/// request except health probes; the stricter <see cref="BookingPolicy"/> write policy is added to the state-changing endpoints
/// (booking and cancellation) with <c>.RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)</c>. A rejection is a 429
/// <c>rate-limited</c> problem with <c>retryAfterSeconds</c> and <c>Retry-After</c>. <c>Security:RateLimiting:Enabled=false</c>
/// (SystemTest) turns all policies off.
/// </summary>
public static class SchedulerRateLimiting
{
    public const string BookingPolicy = "booking";
    public const string TriagePolicy = "triage";

    private const int SegmentsPerWindow = 6;

    // PartitionedRateLimiter caches one limiter per partition key, so unlimited partitions need a key no client address can take.
    private const string UnlimitedPartition = "(unlimited)";

    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public static IServiceCollection AddSchedulerRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(_ => { });
        services.AddOptions<RateLimiterOptions>()
            .Configure<IOptions<SecurityOptions>>((options, security) => Configure(options, security.Value.RateLimiting));
        return services;
    }

    internal static void Configure(RateLimiterOptions options, SecurityOptions.RateLimitingOptions settings)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http => GlobalPartition(http, settings));
        options.AddPolicy(BookingPolicy, http => BookingPartition(http, settings));
        options.AddPolicy(TriagePolicy, http => settings.Enabled
            ? SlidingWindow(ClientKey(http), settings.TriagePermitsPerMinute) : RateLimitPartition.GetNoLimiter(UnlimitedPartition));
        options.OnRejected = WriteRejectionAsync;
    }

    /// <summary>
    /// Documents the 429 <c>rate-limited</c> problem and its <c>Retry-After</c> header on an endpoint. The global limiter covers every
    /// route, so every endpoint declares it, with a <c>&lt;response code="429"&gt;</c> comment on its handler (Addendum B §B2).
    /// </summary>
    public static RouteHandlerBuilder ProducesRateLimitedProblem(this RouteHandlerBuilder builder) =>
        builder.ProducesProblem(StatusCodes.Status429TooManyRequests)
            .WithResponseHeader(
                StatusCodes.Status429TooManyRequests,
                HeaderNames.RetryAfter,
                "Whole seconds to wait before retrying (RFC 9110 delay-seconds); the problem's retryAfterSeconds carries the same value.",
                type: JsonSchemaType.Integer);

    internal static RateLimitPartition<string> GlobalPartition(HttpContext http, SecurityOptions.RateLimitingOptions settings)
    {
        // Platform health probes come from a handful of addresses; limiting them would restart healthy instances.
        var path = http.Request.Path;
        return !settings.Enabled || path.StartsWithSegments("/health") || path.StartsWithSegments("/alive")
            ? RateLimitPartition.GetNoLimiter(UnlimitedPartition)
            : SlidingWindow(ClientKey(http), settings.GlobalPermitsPerMinute);
    }

    internal static RateLimitPartition<string> BookingPartition(HttpContext http, SecurityOptions.RateLimitingOptions settings) =>
        settings.Enabled ? SlidingWindow(ClientKey(http), settings.BookingPermitsPerMinute) : RateLimitPartition.GetNoLimiter(UnlimitedPartition);

    /// <summary>When a rejected client may retry: the limiter's own hint, else one window segment (when the next permits free up).</summary>
    internal static TimeSpan RetryAfter(RateLimitLease lease) =>
        lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter) && retryAfter > TimeSpan.Zero ? retryAfter : Window / SegmentsPerWindow;

    private static string ClientKey(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static RateLimitPartition<string> SlidingWindow(string client, int permitsPerMinute) =>
        RateLimitPartition.GetSlidingWindowLimiter(client, _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = permitsPerMinute,
            Window = Window,
            SegmentsPerWindow = SegmentsPerWindow,
            QueueLimit = 0,
        });

    private static async ValueTask WriteRejectionAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var http = context.HttpContext;
        if (http.GetEndpoint()?.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName == TriagePolicy)
        {
            Common.Telemetry.SchedulerTelemetry.TriageRequests.Add(1, new KeyValuePair<string, object?>("outcome", "rejected"));
        }
        var seconds = (int)Math.Ceiling(RetryAfter(context.Lease).TotalSeconds);
        http.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        http.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Type = ProblemTypes.RateLimited,
            Title = ProblemTypes.TitleFor(ProblemTypes.RateLimited),
            Detail = string.Create(CultureInfo.InvariantCulture, $"Too many requests from this client. Retry after {seconds} seconds."),
            Instance = http.Request.Path,
        };
        problem.Extensions["retryAfterSeconds"] = seconds;

        // TryWriteAsync, not WriteAsync: when the client's Accept header excludes JSON nothing can be written, and WriteAsync would
        // throw, turning the 429 into a 500. The status and Retry-After above already carry the answer.
        await http.RequestServices.GetRequiredService<IProblemDetailsService>().TryWriteAsync(new ProblemDetailsContext { HttpContext = http, ProblemDetails = problem });
    }
}

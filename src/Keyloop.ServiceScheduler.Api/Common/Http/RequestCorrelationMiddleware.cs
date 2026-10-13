using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>Assigns a validated or generated UUID request id to the response header, current <see cref="Activity"/>, and log scope.</summary>
internal sealed class RequestCorrelationMiddleware(ILogger<RequestCorrelationMiddleware> logger) : IMiddleware
{
    public const string HeaderName = "X-Request-Id";

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        var values = context.Request.Headers[HeaderName];
        var requestId = values.Count == 1 && values[0] is { Length: 36 } supplied && Guid.TryParseExact(supplied, "D", out _)
            ? supplied
            : Guid.NewGuid().ToString("D");

        Activity.Current?.SetTag("request.id", requestId);
        using var scope = logger.RequestScope(requestId);
        // The exception handler can clear headers. Set this when the final response starts, including problems, 429s and redirects.
        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = requestId;
            return Task.CompletedTask;
        });
        await next(context);
    }
}

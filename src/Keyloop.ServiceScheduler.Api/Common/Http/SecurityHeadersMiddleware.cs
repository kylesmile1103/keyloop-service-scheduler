namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Security headers on every response (ARCHITECTURE §11.2), plus <c>Cache-Control: no-store</c> under <c>/api</c>. Set when the
/// response starts, so they survive the exception handler clearing the response and also reach problem, 404 and 429 responses.
/// HSTS is added separately (<c>UseHsts</c>) outside Development, SystemTest and Demo.
/// </summary>
public sealed class SecurityHeadersMiddleware : IMiddleware
{
    public Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        context.Response.OnStarting(static state =>
        {
            var http = (HttpContext)state;
            var headers = http.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            headers.XFrameOptions = "DENY";
            if (http.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
            {
                headers.CacheControl = "no-store";
            }

            return Task.CompletedTask;
        }, context);
        return next(context);
    }
}

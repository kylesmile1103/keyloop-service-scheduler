using System.Globalization;
using Microsoft.AspNetCore.Authorization;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Security headers on every response (ARCHITECTURE §11.2), plus <c>Cache-Control: no-store</c> under <c>/api</c> unless a successful
/// anonymous GET explicitly opts into <see cref="PublicReadCacheMetadata"/>. Set when the
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
                var endpoint = http.GetEndpoint();
                headers.CacheControl = http.Response.StatusCode == StatusCodes.Status200OK
                    && HttpMethods.IsGet(http.Request.Method)
                    && endpoint?.Metadata.GetMetadata<IAllowAnonymous>() is not null
                    && endpoint.Metadata.GetMetadata<PublicReadCacheMetadata>() is { } cache
                    ? string.Create(CultureInfo.InvariantCulture, $"public, max-age={cache.MaxAgeSeconds}, must-revalidate")
                    : "no-store";
            }

            return Task.CompletedTask;
        }, context);
        return next(context);
    }
}

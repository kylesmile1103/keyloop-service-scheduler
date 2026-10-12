namespace Keyloop.ServiceScheduler.Api.Features.Admin.Shared;

/// <summary>Registered before the exception handler so its callback restores the 412 ETag after framework cache-header clearing.</summary>
public sealed class AdminPreconditionHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext http)
    {
        http.Response.OnStarting(() =>
        {
            if (http.Response.StatusCode == 412 && http.Items.TryGetValue(typeof(AdminPreconditionException), out var value) && value is string tag)
            {
                http.Response.Headers.ETag = tag;
            }
            return Task.CompletedTask;
        });
        return next(http);
    }
}

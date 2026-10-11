namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Sets the request's <see cref="CurrentActor"/> for the audit trail. Authentication is deferred (SYSTEM_DESIGN §11.3), so every
/// request is <c>anonymous:&lt;client-ip&gt;</c>; once auth is wired this becomes the authenticated principal.
/// </summary>
public sealed class CurrentActorMiddleware(CurrentActor actor) : IMiddleware
{
    public Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        actor.Name = $"anonymous:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
        return next(context);
    }
}

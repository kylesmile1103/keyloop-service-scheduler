using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Sets the authenticated email, or anonymous client IP, on the audit trail (ADR-027).
/// </summary>
public sealed class CurrentActorMiddleware(CurrentActor actor) : IMiddleware
{
    public Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        actor.Name = SchedulerRoles.Email(context.User) is { } email ? $"user:{email}" : $"anonymous:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
        return next(context);
    }
}

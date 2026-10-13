using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>Populates <see cref="CurrentActor"/> from the authenticated user's email or the client IP address.</summary>
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

using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

public sealed class AuthorizationProblemHandler : IAuthorizationMiddlewareResultHandler
{
    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult result)
    {
        if (result.Succeeded) { await next(context); return; }
        var unauthenticated = result.Challenged;
        context.Response.StatusCode = unauthenticated ? StatusCodes.Status401Unauthorized : StatusCodes.Status403Forbidden;
        var type = unauthenticated ? ProblemTypes.Unauthenticated : ProblemTypes.Forbidden;
        var problem = new ProblemDetails
        {
            Status = context.Response.StatusCode, Type = type, Title = ProblemTypes.TitleFor(type),
            Detail = unauthenticated ? "Sign in to perform this action." : "Your role does not permit this action.",
        };
        if (unauthenticated)
        {
            problem.Extensions["loginUrl"] = AuthUrls.Login();
        }
        // ProblemDetailsService can decline for Accept: text/html. The fallback still uses the registered source-generated resolver.
        if (!await context.RequestServices.GetRequiredService<IProblemDetailsService>().TryWriteAsync(new ProblemDetailsContext
            { HttpContext = context, ProblemDetails = problem }))
        {
            problem.Instance = context.Request.Path;
            problem.Extensions["traceId"] = System.Diagnostics.Activity.Current?.Id ?? context.TraceIdentifier;
            await context.Response.WriteAsJsonAsync(problem, SchedulerJsonContext.Default.ProblemDetails, contentType: "application/problem+json", cancellationToken: context.RequestAborted);
        }
    }
}

using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Keyloop.ServiceScheduler.Api.Features.Identity.GetCurrentUser;

/// <summary>The caller's verified identity and API roles. URLs are same-origin Access navigation targets.</summary>
/// <param name="Authenticated">Whether the API verified the caller's identity.</param>
/// <param name="Email">The verified email; null when not authenticated.</param>
/// <param name="DisplayName">The verified name, else null.</param>
/// <param name="Roles">API roles in the order Admin, ServiceAdvisor, Viewer; empty without one.</param>
/// <param name="LoginUrl">The same-origin Access login path, returning to <c>/</c>.</param>
/// <param name="LogoutUrl">The hostname's Access logout path.</param>
/// <param name="ExpiresAtUtc">When the verified Access token expires (its <c>exp</c>, UTC); null for an anonymous caller and for the Development identity, which has no expiry. Access issues no refresh token: renew before then by navigating to loginUrl.</param>
public sealed record CurrentUserResponse(bool Authenticated, string? Email, string? DisplayName, string[] Roles, string LoginUrl, string LogoutUrl,
    DateTime? ExpiresAtUtc);

public sealed class GetCurrentUserEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/me", Handle)
        .WithName("GetCurrentUser").WithTags("Identity").AllowAnonymous()
        .Produces<CurrentUserResponse>().ProducesRateLimitedProblem();

    /// <summary>Get the current caller and sign-in/out URLs</summary>
    /// <remarks>Returns authenticated status, verified identity claims, configured API roles, session expiry, and same-origin Access login and logout URLs.</remarks>
    /// <response code="200">The current identity, ordered API roles (Admin, ServiceAdvisor, Viewer), the session's expiry, and same-origin loginUrl/logoutUrl.</response>
    /// <response code="429">Too many requests (<c>rate-limited</c>, with <c>Retry-After</c>).</response>
    internal static Ok<CurrentUserResponse> Handle(HttpContext http)
    {
        var authenticated = http.User.Identity?.IsAuthenticated == true;
        var expires = authenticated ? http.Features.Get<IAuthenticateResultFeature>()?.AuthenticateResult?.Properties?.ExpiresUtc : null;
        return TypedResults.Ok(new CurrentUserResponse(
            authenticated, SchedulerRoles.Email(http.User), authenticated ? http.User.Identity!.Name : null,
            [.. SchedulerRoles.All.Where(http.User.IsInRole)], AuthUrls.Login(), AuthUrls.Logout, expires?.UtcDateTime));
    }
}

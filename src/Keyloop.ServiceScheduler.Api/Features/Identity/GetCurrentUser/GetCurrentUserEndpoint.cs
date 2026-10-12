using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Keyloop.ServiceScheduler.Api.Features.Identity.GetCurrentUser;

/// <summary>The caller's verified identity and API roles. URLs are same-origin Access navigation targets.</summary>
public sealed record CurrentUserResponse(bool Authenticated, string? Email, string? DisplayName, string[] Roles, string LoginUrl, string LogoutUrl);

public sealed class GetCurrentUserEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/me", Handle)
        .WithName("GetCurrentUser").WithTags("Identity")
        .Produces<CurrentUserResponse>().ProducesRateLimitedProblem();

    /// <summary>Get the current caller and sign-in/out URLs</summary>
    /// <remarks>Anonymous and invalid/expired sessions return authenticated false, null email/displayName and no roles. Verified users without a configured role are authenticated with an empty roles array. Navigate to loginUrl for Access login and logoutUrl for hostname cookie removal. The response is never cached.</remarks>
    /// <response code="200">The current identity, ordered API roles (Admin, ServiceAdvisor, Viewer), and same-origin loginUrl/logoutUrl.</response>
    /// <response code="429">Too many requests (<c>rate-limited</c>, with <c>Retry-After</c>).</response>
    internal static Ok<CurrentUserResponse> Handle(HttpContext http) => TypedResults.Ok(new CurrentUserResponse(
        http.User.Identity?.IsAuthenticated == true, SchedulerRoles.Email(http.User),
        http.User.Identity?.IsAuthenticated == true ? http.User.Identity.Name : null,
        [.. SchedulerRoles.All.Where(http.User.IsInRole)], AuthUrls.Login(), AuthUrls.Logout));
}

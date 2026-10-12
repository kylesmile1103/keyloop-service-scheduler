using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Shared;

internal static class AdminEndpointConventions
{
    public static RouteHandlerBuilder AdminRead(this RouteHandlerBuilder route, string name) => route.WithName(name).WithTags(ApiTags.Admin)
        .WithMetadata(new AdminEditingMetadata())
        .RequireAuthorization(SchedulerAuthentication.Admin)
        .ProducesProblem(401).ProducesProblem(403).ProducesProblem(404).ProducesRateLimitedProblem();

    public static RouteHandlerBuilder AdminWrite(this RouteHandlerBuilder route, string name, bool edit) =>
        EditProblems(route.AdminRead(name).RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)
            .ProducesValidationProblem().ProducesProblem(413), edit);

    private static RouteHandlerBuilder EditProblems(RouteHandlerBuilder route, bool edit) => edit
        ? route.ProducesProblem(412).ProducesProblem(428).WithResponseHeader(412, "ETag", "Current strong version; also present in currentETag.")
        : route;

    public static void ETag(HttpContext http, string tag)
    {
        http.Response.Headers.ETag = tag;
        http.Response.Headers.CacheControl = "private, no-store";
    }
}

internal sealed record AdminEditingMetadata;

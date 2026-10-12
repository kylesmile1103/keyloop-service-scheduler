using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

/// <summary>
/// <c>POST /api/v1/admin/demo/reseed</c>, behind the Aspire dashboard's <em>Reseed demo data</em> command (Addendum C §C3, ADR-019).
/// </summary>
/// <remarks>
/// <see cref="EndpointRegistry"/> maps it only where demo data is seeded and <c>Demo:ReseedKey</c> is configured, which is the
/// Development run under Aspire (the AppHost generates the key for each run); UAT and Production seed no demo data. After Admin authorization, a missing or wrong
/// <see cref="KeyHeader"/> is answered with the same 404 as an unknown route rather than a 401, so the route is not advertised. It is
/// excluded from the OpenAPI document, keeping the build-time contract identical in every environment, and it is rate-limited by the
/// write policy like the other state-changing routes.
/// </remarks>
public sealed class ReseedDemoDataEndpoint : IEndpoint
{
    /// <summary>The header carrying the key.</summary>
    public const string KeyHeader = "X-Reseed-Key";

    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPost("/admin/demo/reseed", HandleAsync)
            .RequireAuthorization(SchedulerAuthentication.Admin)
            .ExcludeFromDescription()
            .RequireRateLimiting(SchedulerRateLimiting.BookingPolicy);

    /// <summary>Replace the demo dealerships' appointments with the deterministic demo week.</summary>
    /// <param name="key">The <see cref="KeyHeader"/> value, compared in fixed time with the configured key.</param>
    /// <param name="handler">Checks the key and reseeds in one transaction.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    internal static async Task<Results<Ok<ReseedDemoDataResponse>, NotFound>> HandleAsync(
        [FromHeader(Name = KeyHeader)] string? key, [FromServices] ReseedDemoDataHandler handler, CancellationToken cancellationToken) =>
        await handler.HandleAsync(key, cancellationToken) is { } outcome ? TypedResults.Ok(outcome) : TypedResults.NotFound();
}

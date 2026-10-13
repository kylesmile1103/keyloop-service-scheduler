using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

/// <summary>
/// <c>POST /api/v1/admin/demo/reseed</c> endpoint for resetting demo appointments, mapped only when demo seeding and <c>Demo:ReseedKey</c> are enabled.
/// </summary>
public sealed class ReseedDemoDataEndpoint : IEndpoint
{
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

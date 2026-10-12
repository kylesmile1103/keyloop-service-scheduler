using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;

public sealed class GetFeaturesEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/features", Handle)
        .WithName("GetFeatures").WithTags(ApiTags.Features).AllowAnonymous()
        .WithMetadata(new PublicReadCacheMetadata(60))
        .Produces<FeatureSwitchesResponse>().ProducesRateLimitedProblem()
        .WithResponseHeader(StatusCodes.Status200OK, HeaderNames.CacheControl,
            "public, max-age=60, must-revalidate: identical for every caller; cached for at most one minute, then revalidated. The effective switches change only after an API restart.");

    /// <summary>Discover this environment's client rendering switches</summary>
    /// <remarks>Public and identical for every caller. Read before displaying vehicle-aware booking controls or sending vehicle-aware availability inputs. The effective switches require an API restart to change, matching booking and availability. Successful responses use Cache-Control: public, max-age=60, must-revalidate. A recently restarted deployment may differ from a cached read; refresh discovery after vehicle-aware-requirements-disabled.</remarks>
    /// <response code="200">Only the vehicleAwareRequirements boolean; no personal data, dealership data, secrets or other settings.</response>
    /// <response code="429">Too many requests from this client (rate-limited, with Retry-After); never cached.</response>
    internal static Ok<FeatureSwitchesResponse> Handle([FromServices] GetFeaturesHandler handler) => TypedResults.Ok(handler.Handle());
}

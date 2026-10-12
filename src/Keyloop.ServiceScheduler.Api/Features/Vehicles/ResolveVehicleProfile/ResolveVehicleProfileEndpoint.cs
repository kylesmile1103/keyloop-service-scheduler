using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;

/// <summary>VIN and registration are body-only, transient inputs. Offline WMI decoding needs no registration.</summary>
/// <param name="Vin">Optional 17-character VIN; never echoed or retained.</param>
/// <param name="Registration">Optional registration, 1..16 characters; no registry lookup is performed.</param>
public sealed record ResolveVehicleProfileRequest(string? Vin = null, string? Registration = null);

public sealed class ResolveVehicleProfileValidator : AbstractValidator<ResolveVehicleProfileRequest>
{
    public ResolveVehicleProfileValidator()
    {
        RuleFor(r => r.Vin).Must(v => v is null || Domain.Scheduling.Vin.TryCreate(v, out _)).WithMessage("vin must be a valid 17-character VIN.");
        RuleFor(r => r.Registration).Must(r => r is null || r.Trim().Length is >= 1 and <= 16).WithMessage("registration must be 1 to 16 characters.");
    }
}

public sealed class ResolveVehicleProfileEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapPost("/vehicle-profiles/resolve", Handle)
        .WithName("ResolveVehicleProfile").WithTags(ApiTags.Appointments)
        .RequireAuthorization(SchedulerAuthentication.BookingsWrite)
        .RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)
        .AddEndpointFilter<ValidationFilter<ResolveVehicleProfileRequest>>()
        .Produces<VehicleProfile>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status401Unauthorized)
        .ProducesProblem(StatusCodes.Status403Forbidden).ProducesProblem(StatusCodes.Status413PayloadTooLarge).ProducesRateLimitedProblem();

    /// <summary>Resolve vehicle attributes from a transient VIN</summary>
    /// <remarks>Booking-flow authorization is required. Offline WMI decoding returns manufacturer provenance VinDecoded or Unknown. Powertrain and class stay Unknown. VIN and registration are never stored, echoed, logged or traced.</remarks>
    /// <response code="200">Vehicle facts with per-attribute provenance, without identifiers.</response>
    /// <response code="400">Malformed identifier (validation-error).</response>
    /// <response code="401">Authentication required.</response>
    /// <response code="403">BookingsWrite role required.</response>
    /// <response code="413">The request body exceeds the configured limit.</response>
    /// <response code="429">Too many requests (rate-limited, Retry-After).</response>
    internal static Ok<VehicleProfile> Handle([FromBody, Description("Transient vehicle identifiers for offline manufacturer decoding. No registry lookup is performed.")] ResolveVehicleProfileRequest request,
        [FromServices] ResolveVehicleProfileHandler handler) => TypedResults.Ok(handler.Handle(request));
}

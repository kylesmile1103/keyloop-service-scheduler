using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.GetAppointment;

/// <summary><c>GET /api/v1/appointments/{appointmentId}</c>: where a booking's <c>Location</c> points.</summary>
public sealed class GetAppointmentEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/appointments/{appointmentId:guid}", HandleAsync)
            .WithName("GetAppointment")
            .WithTags(ApiTags.Appointments)
            .RequireAuthorization(SchedulerAuthentication.AppointmentDetails)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .Produces<AppointmentResponse>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem();

    /// <summary>Get an appointment</summary>
    /// <remarks>Returns an appointment in any status (including cancelled), with its service, bay, technician, local times, customer, and vehicle.</remarks>
    /// <param name="appointmentId">The appointment's id, as returned by the booking (its <c>id</c>, or the last segment of its <c>Location</c>).</param>
    /// <param name="handler">Reads the appointment and what it references.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">The appointment.</response>
    /// <response code="404">No appointment has this id (<c>not-found</c>, with <c>resource</c> = <c>appointment</c> and the <c>id</c>).</response>
    /// <response code="401">Sign-in required (<c>unauthenticated</c>, with <c>loginUrl</c>).</response>
    /// <response code="403">The caller's role does not permit this operation (<c>forbidden</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<AppointmentResponse>> HandleAsync(
        Guid appointmentId, [FromServices] GetAppointmentHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(appointmentId, cancellationToken));
}

using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary><c>POST /api/v1/appointments/{appointmentId}/cancel</c>.</summary>
public sealed class CancelAppointmentEndpoint : IEndpoint
{
    /// <summary>The request body's description in the OpenAPI document.</summary>
    internal const string RequestDescription = "The cancellation: why the appointment is cancelled.";

    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPost("/appointments/{appointmentId:guid}/cancel", HandleAsync)
            .WithName("CancelAppointment")
            .WithTags(ApiTags.Appointments)
            .AddEndpointFilter<ValidationFilter<CancelAppointmentRequest>>()
            // A state-changing POST: the stricter write policy, on top of the global limiter (ARCHITECTURE §11.1).
            .RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)
            .Produces<AppointmentResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesRateLimitedProblem();

    /// <summary>Cancel an appointment</summary>
    /// <remarks>
    /// Cancels a confirmed or checked-in appointment and records why. Its bay and technician are free again at once, so the slot is
    /// re-bookable; the appointment stays readable, with status <c>Cancelled</c> and the reason as <c>cancellationReason</c>. Cancelling is
    /// not repeatable: a second cancel, or one after work has started, is refused with the current status. When another request changed
    /// the appointment after this one read it, nothing is overwritten: read it again and decide.
    /// </remarks>
    /// <param name="appointmentId">The appointment to cancel.</param>
    /// <param name="request">
    /// The reason. Its OpenAPI description is <see cref="RequestDescription"/>, given by the <c>[Description]</c> attribute: the XML-comment
    /// generator also copies the other parameters' tags here, so <c>SchedulerOpenApi</c> puts the attribute's text back.
    /// </param>
    /// <param name="handler">Applies the transition under optimistic concurrency.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">Cancelled: the appointment with status <c>Cancelled</c>, its <c>cancellationReason</c> and the time of the change as <c>updatedAtUtc</c>.</response>
    /// <response code="400">The reason is missing, blank or longer than 500 characters (<c>validation-error</c>, <c>errors</c> keyed <c>reason</c>), or the body is not valid JSON.</response>
    /// <response code="404">No appointment has this id (<c>not-found</c>, with <c>resource</c> = <c>appointment</c> and the <c>id</c>).</response>
    /// <response code="409">The appointment cannot be cancelled in its current status (<c>invalid-state-transition</c>, with <c>currentStatus</c> and <c>attempted</c> = <c>cancel</c>), or another request changed it after this one read it (<c>concurrency-conflict</c>: read it again).</response>
    /// <response code="429">Too many state-changing requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<AppointmentResponse>> HandleAsync(
        Guid appointmentId,
        [Description(RequestDescription)] CancelAppointmentRequest request,
        [FromServices] CancelAppointmentHandler handler,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(appointmentId, request.Reason, cancellationToken));
}

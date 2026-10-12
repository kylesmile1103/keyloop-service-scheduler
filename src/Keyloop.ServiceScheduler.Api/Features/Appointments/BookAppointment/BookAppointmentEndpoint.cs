using Keyloop.ServiceScheduler.Api.Common.Authentication;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary><c>POST /api/v1/dealerships/{dealershipId}/appointments</c> (optional header <c>Idempotency-Key</c>).</summary>
public sealed class BookAppointmentEndpoint : IEndpoint
{
    /// <summary>The request body's description in the OpenAPI document.</summary>
    internal const string RequestDescription =
        "The booking: the service and its start time, the customer and the vehicle, with an optional preferred bay, technician and notes.";

    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPost("/dealerships/{dealershipId:guid}/appointments", HandleAsync)
            .WithName("BookAppointment")
            .WithTags(ApiTags.Appointments)
            .RequireAuthorization(SchedulerAuthentication.BookingsWrite)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .AddEndpointFilter<BookingValidationTelemetryFilter>() // outermost: sees every validation-error, from the body or the header
            .AddEndpointFilter<ValidationFilter<BookAppointmentRequest>>()
            .RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)
            .Produces<AppointmentResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .ProducesRateLimitedProblem()
            .WithResponseHeader(StatusCodes.Status201Created, "Location", "The new appointment's path, /api/v1/appointments/{id} (the same id on a replay).", "uri-reference")
            .WithResponseHeader(
                StatusCodes.Status201Created,
                IdempotencyKeyHeader.ReplayedName,
                "Present, with the value true, only when the response is the stored result of an earlier request with the same Idempotency-Key.");

    /// <summary>Book an appointment</summary>
    /// <remarks>
    /// Reserves one bay with every capability the service requires and one technician with every certification it requires for the
    /// whole slot, so neither is ever double-booked: bookings at a dealership are serialised and the database refuses any overlap. A free
    /// preferred bay or technician is honoured; otherwise the allocation policy keeps specialised resources free, then balances the day's
    /// load. Send an <c>Idempotency-Key</c> (for example a UUID) to make retries safe: repeating a booking that succeeded in the last 24 hours
    /// with the same key and body returns the stored 201 with <c>Idempotent-Replayed: true</c> and books nothing; only successes are stored.
    /// With Scheduling:VehicleAwareRequirements enabled, optional vehicle.profile facts refine the hard requirements. Omitted powertrain is Unknown and conservative HV.
    /// A concrete powertrain requires a private declarationReason of 1 to 500 trimmed characters; source and actor are assigned by the server.
    /// Decoded manufacturer conflicts require profile.conflictChoice UseDecoded explicitly. NeedsLiveDiagnosis requests level 4 for HV jobs.
    /// Successful vehicle-aware responses include allocation criterion, policy version, minimum HV level, fired rules and preferred-resource reason codes.
    /// </remarks>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">The dealership to book at (the example is the seeded Reading dealership).</param>
    /// <param name="request">
    /// The booking. Its OpenAPI description is <see cref="RequestDescription"/>, given by the <c>[Description]</c> attribute: the
    /// XML-comment generator also copies the other parameters' tags here, so <c>SchedulerOpenApi</c> puts the attribute's text back.
    /// </param>
    /// <param name="idempotencyKey">
    /// The optional <c>Idempotency-Key</c> header. Its OpenAPI description is <see cref="IdempotencyKeyHeader.Description"/>, given by the
    /// <c>[Description]</c> attribute: the XML-comment generator matches this tag by the C# name, not the header name.
    /// </param>
    /// <param name="handler">Checks the rules, allocates and books under the dealership's lock.</param>
    /// <param name="httpContext">Carries the <c>Idempotent-Replayed</c> header on a replay.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="201">Booked: the appointment with its bay, technician and local times; <c>Location</c> is its path. A replay carries <c>Idempotent-Replayed: true</c>.</response>
    /// <response code="400">The body or the <c>Idempotency-Key</c> is malformed (<c>validation-error</c>, <c>errors</c> keyed by JSON path such as <c>customer.email</c>, or <c>Idempotency-Key</c>).</response>
    /// <response code="404">No dealership or no service type has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> or <c>service-type</c> and the <c>id</c>).</response>
    /// <response code="409">The slot is taken: every qualified bay or technician is busy (<c>slot-unavailable</c>), or the database's overlap backstop fired (<c>slot-conflict</c>, with <c>conflictingResource</c>); both carry <c>suggestedSlots</c>, the nearest bookable starts that day.</response>
    /// <response code="413">The request body exceeds the 64 KiB limit (framework RFC 9110 problem).</response>
    /// <response code="422">A business rule refuses it: <c>outside-operating-hours</c>, <c>lead-time-not-met</c>, <c>beyond-booking-horizon</c>, <c>slot-not-aligned</c>, <c>no-qualified-resources</c>, or <c>idempotency-key-reuse</c>, or <c>vehicle-profile-conflict</c>. Vehicle-aware no-qualified-resources adds minimumHvLevel, requiredBrand (null in this phase) and firedRules.</response>
    /// <response code="401">Sign-in required (<c>unauthenticated</c>, with <c>loginUrl</c>).</response>
    /// <response code="403">The caller's role does not permit this operation (<c>forbidden</c>).</response>
    /// <response code="429">Too many bookings from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Results<Created<AppointmentResponse>, ValidationProblem>> HandleAsync(
        Guid dealershipId,
        [Description(RequestDescription)] BookAppointmentRequest request,
        [FromHeader(Name = IdempotencyKeyHeader.Name)]
        [Description(IdempotencyKeyHeader.Description)]
        [StringLength(IdempotencyKeyHeader.MaxLength, MinimumLength = 1)]
        [RegularExpression(IdempotencyKeyHeader.Pattern)]
        string? idempotencyKey,
        [FromServices] BookAppointmentHandler handler,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        // The attributes above only document the header (no DataAnnotations validation runs in minimal APIs); this is the check.
        if (IdempotencyKeyHeader.Validate(idempotencyKey) is { } error)
        {
            return ProblemResults.Validation(new Dictionary<string, string[]> { [IdempotencyKeyHeader.Name] = [error] });
        }

        var result = await handler.HandleAsync(new BookAppointmentCommand(dealershipId, request, idempotencyKey), cancellationToken);
        if (result.Replayed)
        {
            httpContext.Response.Headers[IdempotencyKeyHeader.ReplayedName] = "true";
        }

        return TypedResults.Created($"/api/v1/appointments/{result.Appointment.Id}", result.Appointment);
    }
}

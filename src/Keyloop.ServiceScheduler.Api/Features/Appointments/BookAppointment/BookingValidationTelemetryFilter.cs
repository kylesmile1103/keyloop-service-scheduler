using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// The booking endpoint's outermost filter: a 400 <c>validation-error</c>, whether from <c>ValidationFilter</c> (the body) or the
/// endpoint's <c>Idempotency-Key</c> check, never reaches the handler, so it is counted here as outcome <c>validation_failed</c> on
/// <c>scheduler.booking.requests</c> and logged as 1002 BookingRejected.
/// </summary>
public sealed class BookingValidationTelemetryFilter(ILogger<BookingValidationTelemetryFilter> logger) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        // ValidationFilter returns a bare ValidationProblem; the endpoint's own result is a Results<Created<…>, ValidationProblem> union.
        var result = await next(context);
        if (result is ValidationProblem or INestedHttpResult { Result: ValidationProblem })
        {
            // The route constraint ({dealershipId:guid}) guarantees the only Guid argument, the dealership id, is bound.
            var dealershipId = context.Arguments.OfType<Guid>().First();
            SchedulerTelemetry.BookingRequests.Add(
                1,
                new KeyValuePair<string, object?>("outcome", BookingOutcomes.ValidationFailed),
                new KeyValuePair<string, object?>("dealership.id", dealershipId.ToString()));
            logger.BookingRejected(BookingOutcomes.ValidationFailed, dealershipId, serviceCode: null);
        }

        return result;
    }
}

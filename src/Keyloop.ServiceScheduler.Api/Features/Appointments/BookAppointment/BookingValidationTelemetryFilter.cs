using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Records validation failure telemetry and logs when a booking request fails body or header validation.
/// </summary>
public sealed class BookingValidationTelemetryFilter(ILogger<BookingValidationTelemetryFilter> logger) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var result = await next(context);
        if (result is ValidationProblem or INestedHttpResult { Result: ValidationProblem })
        {
            var dealershipId = context.Arguments.OfType<Guid>().First();
            Activity.Current?.SetTag("dealership.id", dealershipId.ToString());
            SchedulerTelemetry.BookingRequests.Add(
                1,
                new KeyValuePair<string, object?>("outcome", BookingOutcomes.ValidationFailed));
            logger.BookingRejected(BookingOutcomes.ValidationFailed, dealershipId, serviceCode: null);
        }

        return result;
    }
}

using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

/// <summary>Measures the whole slice including validation; only bounded categories enter telemetry.</summary>
public sealed class TriageTelemetryFilter(IOptions<TriageConnectionOptions> options) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var started = Stopwatch.GetTimestamp();
        var outcome = "rejected";
        string? reason = null;
        using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.triage");
        activity?.SetTag("dealership.id", context.HttpContext.Request.RouteValues["dealershipId"]?.ToString());
        activity?.SetTag("triage.model", options.Value.Model);
        try
        {
            var result = await next(context);
            if (result is IValueHttpResult { Value: TriageBookingResponse response })
            {
                outcome = response.Recommendation;
                activity?.SetTag("triage.recommendation", response.Recommendation);
            }
            return result;
        }
        catch (TriageUnavailableException ex)
        {
            outcome = "unavailable";
            reason = ex.Reason;
            activity?.SetStatus(ActivityStatusCode.Error);
            throw;
        }
        finally
        {
            activity?.SetTag("triage.outcome", outcome);
            var tags = new TagList { { "outcome", outcome } };
            if (reason is not null)
            {
                tags.Add("reason", reason);
            }
            SchedulerTelemetry.TriageRequests.Add(1, tags);
            SchedulerTelemetry.TriageDuration.Record(Stopwatch.GetElapsedTime(started).TotalSeconds, tags);
        }
    }
}

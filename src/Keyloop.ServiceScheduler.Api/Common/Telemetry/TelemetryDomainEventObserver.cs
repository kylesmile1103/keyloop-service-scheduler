using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>Records structured logs and metrics for committed booking and cancellation domain events without logging PII.</summary>
public sealed class TelemetryDomainEventObserver(ILogger<TelemetryDomainEventObserver> logger) : IDomainEventObserver
{
    public Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(events);
        foreach (var domainEvent in events)
        {
            switch (domainEvent)
            {
                case AppointmentBooked booked:
                    if (booked.Allocation is { } decision)
                    {
                        SchedulerTelemetry.AllocationDecidedBy.Add(1, new KeyValuePair<string, object?>("criterion", decision.DecidedBy.ToString()));
                    }
                    logger.BookingConfirmed(booked.AppointmentId, booked.DealershipId, booked.BayId, booked.TechnicianId, booked.StartUtc, booked.MaskedVin);
                    break;
                case AppointmentCancelled cancelled:
                    SchedulerTelemetry.Cancellations.Add(1, new KeyValuePair<string, object?>("previous_status", cancelled.PreviousStatus.ToString()));
                    logger.AppointmentCancelled(cancelled.AppointmentId, cancelled.PreviousStatus);
                    break;
            }
        }

        return Task.CompletedTask;
    }
}

using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Logs and counts committed domain events: 1001 BookingConfirmed (ids, start and the masked VIN only) and 1010
/// AppointmentCancelled, which also increments <c>scheduler.appointments.cancellations</c> by previous status. The cancellation
/// reason is free text that may carry PII, so it is never logged (SYSTEM_DESIGN §11.1).
/// </summary>
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

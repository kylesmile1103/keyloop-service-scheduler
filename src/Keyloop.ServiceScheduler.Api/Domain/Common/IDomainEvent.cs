namespace Keyloop.ServiceScheduler.Api.Domain.Common;

public interface IDomainEvent
{
    Guid AppointmentId { get; }

    DateTime OccurredAtUtc { get; }

    string EventType { get; }
}

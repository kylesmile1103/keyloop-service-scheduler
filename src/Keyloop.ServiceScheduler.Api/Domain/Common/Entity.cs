namespace Keyloop.ServiceScheduler.Api.Domain.Common;

public abstract class Entity
{
    public Guid Id { get; protected init; }
}

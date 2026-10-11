using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Domain.Dealerships;

public readonly record struct OperatingWindow(DateTime StartUtc, DateTime EndUtc)
{
    public bool Contains(TimeSlot slot) => slot.StartUtc >= StartUtc && slot.EndUtc <= EndUtc;
}

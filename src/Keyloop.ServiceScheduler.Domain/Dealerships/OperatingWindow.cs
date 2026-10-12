using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Domain.Dealerships;

public readonly record struct OperatingWindow(DateTime StartUtc, DateTime EndUtc)
{
    public bool Contains(TimeSlot slot) => slot.StartUtc >= StartUtc && slot.EndUtc <= EndUtc;
}

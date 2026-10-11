using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries;

/// <summary>
/// Read model for one dealership-day (SYSTEM_DESIGN §5.3): the dealership, its resources and the appointments overlapping an
/// operating window, read without tracking. Shared by availability, suggestions, allocation load and the workshop schedule.
/// </summary>
public sealed class DayScheduleReader(SchedulerDbContext db)
{
    /// <summary>
    /// <see cref="Bays"/> and <see cref="Technicians"/> hold every resource of the dealership, active or not, ordered by name;
    /// <see cref="Appointments"/> are those overlapping the window, ordered by start.
    /// </summary>
    public sealed record DaySnapshot(
        Dealership Dealership, IReadOnlyList<ServiceBay> Bays, IReadOnlyList<Technician> Technicians, IReadOnlyList<AppointmentRow> Appointments);

    /// <summary>The columns a day view needs. <see cref="Vin"/> is the full VIN; mask it where the audience requires.</summary>
    public sealed record AppointmentRow(
        Guid Id, Guid BayId, Guid TechnicianId, Guid ServiceTypeId, TimeSlot Slot, AppointmentStatus Status, string Vin, string Registration, string CustomerName);

    /// <summary>
    /// The dealership-day, or <see langword="null"/> when the dealership does not exist. <paramref name="activeOnly"/> keeps only
    /// appointments that occupy resources (<see cref="Appointment.ActiveStatuses"/>).
    /// </summary>
    public async Task<DaySnapshot?> ReadAsync(Guid dealershipId, OperatingWindow window, bool activeOnly, CancellationToken ct)
    {
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealershipId, ct);
        return dealership is null ? null : await ReadAsync(dealership, window, activeOnly, ct);
    }

    /// <summary>
    /// The day of a dealership the caller has already loaded (it resolved the operating window from it), without reading it
    /// again; <see cref="DaySnapshot.Dealership"/> is that instance. Otherwise as <see cref="ReadAsync(Guid, OperatingWindow, bool, CancellationToken)"/>.
    /// </summary>
    public async Task<DaySnapshot> ReadAsync(Dealership dealership, OperatingWindow window, bool activeOnly, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(dealership);
        var dealershipId = dealership.Id;
        var bays = await db.ServiceBays.AsNoTracking()
            .Where(b => b.DealershipId == dealershipId)
            .OrderBy(b => b.Name).ThenBy(b => b.Id)
            .ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking()
            .Where(t => t.DealershipId == dealershipId)
            .OrderBy(t => t.Name).ThenBy(t => t.Id)
            .ToListAsync(ct);

        var rows = await Overlapping(dealershipId, window, activeOnly)
            .OrderBy(a => a.Slot.StartUtc).ThenBy(a => a.Id)
            .Select(a => new
            {
                a.Id,
                a.BayId,
                a.TechnicianId,
                a.ServiceTypeId,
                a.Slot.StartUtc,
                a.Slot.EndUtc,
                a.Status,
                a.Vehicle.Vin,
                a.Vehicle.Registration,
                CustomerName = a.Customer.Name,
            })
            .ToListAsync(ct);

        var appointments = rows
            .Select(r => new AppointmentRow(
                r.Id, r.BayId, r.TechnicianId, r.ServiceTypeId, TimeSlot.Create(r.StartUtc, r.EndUtc), r.Status, r.Vin.Value, r.Registration, r.CustomerName))
            .ToList();
        return new DaySnapshot(dealership, bays, technicians, appointments);
    }

    /// <summary>
    /// Active appointments overlapping the window per bay id and per technician id, merged into one dictionary (ids are unique
    /// across both). A resource without appointments has no entry. This is the allocation policy's "load today".
    /// </summary>
    public async Task<Dictionary<Guid, int>> LoadCountsAsync(Guid dealershipId, OperatingWindow window, CancellationToken ct)
    {
        var assignments = await Overlapping(dealershipId, window, activeOnly: true)
            .Select(a => new { a.BayId, a.TechnicianId })
            .ToListAsync(ct);

        var counts = new Dictionary<Guid, int>();
        foreach (var assignment in assignments)
        {
            counts[assignment.BayId] = counts.GetValueOrDefault(assignment.BayId) + 1;
            counts[assignment.TechnicianId] = counts.GetValueOrDefault(assignment.TechnicianId) + 1;
        }

        return counts;
    }

    private IQueryable<Appointment> Overlapping(Guid dealershipId, OperatingWindow window, bool activeOnly)
    {
        var start = window.StartUtc;
        var end = window.EndUtc;
        var query = db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == dealershipId && a.Slot.StartUtc < end && a.Slot.EndUtc > start);
        return activeOnly ? query.Where(a => Appointment.ActiveStatuses.Contains(a.Status)) : query;
    }
}

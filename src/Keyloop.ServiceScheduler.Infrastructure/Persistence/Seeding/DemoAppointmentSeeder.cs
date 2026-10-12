using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

/// <summary>
/// Places sample appointments at Reading over the coming week so the dispatch board is never empty (ARCHITECTURE A-14).
/// Appointments are booked through the aggregate and allocated by the same calculator and policy as real bookings, so they are
/// valid, audited (<c>Booked</c> history rows) and never overlap.
/// </summary>
public static class DemoAppointmentSeeder
{
    public const int Days = 7;

    // (service code, local start) walked in order each open day; entries that do not fit the day or find no free resources are skipped.
    private static readonly (string Code, TimeOnly LocalStart)[] DailyPattern =
    [
        ("INTERIM-SERVICE", new TimeOnly(8, 0)),
        ("EV-BATTERY-CHECK", new TimeOnly(9, 0)),
        ("BRAKES-PADS-DISCS", new TimeOnly(10, 30)),
        ("MOT-TEST", new TimeOnly(11, 0)),
        ("FULL-SERVICE", new TimeOnly(13, 0)),
        ("WHEEL-ALIGNMENT", new TimeOnly(15, 0)),
    ];

    private static readonly (string Name, string Email, string Phone, string Vin, string Registration, string Make, string Model)[] Customers =
    [
        ("Olivia Bennett", "olivia.bennett@example.com", "+44 7700 900101", "WVWZZZ1KZAW123456", "RE21 KLM", "Volkswagen", "Golf"),
        ("Harry Whitfield", "harry.whitfield@example.com", "+44 7700 900102", "SB1KZ3JE60E123457", "RG19 TPX", "Toyota", "Corolla"),
        ("Priya Sharma", "priya.sharma@example.com", "+44 7700 900103", "WBA3A5C58DF123458", "LV68 ZRA", "BMW", "3 Series"),
        ("George Atkinson", "george.atkinson@example.com", "+44 7700 900104", "VF1RFB00X59123459", "RX17 WDN", "Renault", "Clio"),
        ("Sophie Turner", "sophie.turner@example.com", "+44 7700 900105", "JTDKN3DU0A0123460", "RF20 BCJ", "Toyota", "Prius"),
        ("Mohammed Rahman", "mohammed.rahman@example.com", "+44 7700 900106", "WF0XXXGCDXDA12346", "RE16 HUV", "Ford", "Focus"),
        ("Emily Clarkson", "emily.clarkson@example.com", "+44 7700 900107", "TMBJF9NE9N0123462", "RK22 OYS", "Škoda", "Octavia"),
        ("Jack Davies", "jack.davies@example.com", "+44 7700 900108", "KMHD35LE2EU123463", "RO14 GFE", "Hyundai", "i30"),
    ];

    /// <summary>
    /// For each of the next <see cref="Days"/> local dates at Reading (today first) on which it is open and which has no
    /// non-cancelled appointment, books the daily pattern from now on. Ids are <c>appointment:{yyyy-MM-dd}:{code}</c>, so a
    /// re-run never duplicates: existing ids (including cancelled rows) are skipped.
    /// </summary>
    /// <returns>The number of appointments created.</returns>
    public static async Task<int> EnsureUpcomingWeekAsync(SchedulerDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == ReferenceDataSeed.ReadingDealershipId, ct)
            ?? throw new InvalidOperationException("Seed the reference data before the demo appointments.");
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealership.Id && b.IsActive).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealership.Id && t.IsActive).ToListAsync(ct);
        var codes = DailyPattern.Select(p => p.Code).ToList();
        var serviceTypes = await db.ServiceTypes.AsNoTracking().Where(s => codes.Contains(s.Code)).ToDictionaryAsync(s => s.Code, ct);

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var zone = dealership.TimeZone;
        var today = LocalTimeConverter.ToLocalDate(nowUtc, zone);
        var created = new List<Appointment>();
        for (var dayIndex = 0; dayIndex < Days; dayIndex++)
        {
            var date = today.AddDays(dayIndex);
            if (dealership.ResolveOperatingWindow(date) is not { } window)
            {
                continue;
            }

            var hasActiveDay = await db.Appointments.AnyAsync(
                a => a.DealershipId == dealership.Id && a.Status != AppointmentStatus.Cancelled
                    && a.Slot.StartUtc < window.EndUtc && a.Slot.EndUtc > window.StartUtc,
                ct);
            if (hasActiveDay)
            {
                continue;
            }

            var ids = DailyPattern.Select(p => AppointmentId(date, p.Code)).ToList();
            var existingIds = (await db.Appointments.AsNoTracking().Where(a => ids.Contains(a.Id)).Select(a => a.Id).ToListAsync(ct)).ToHashSet();
            var booked = new List<Appointment>();
            for (var i = 0; i < DailyPattern.Length; i++)
            {
                var (code, localStart) = DailyPattern[i];
                if (existingIds.Contains(ids[i]) || !serviceTypes.TryGetValue(code, out var serviceType))
                {
                    continue;
                }

                var slot = TimeSlot.FromStart(LocalTimeConverter.ToUtc(date, localStart, zone), serviceType.Duration);
                if (slot.StartUtc < nowUtc || !window.Contains(slot))
                {
                    continue;
                }

                var freeBayIds = AvailabilityCalculator.FreeResourcesAt(slot, Busy(bays.Select(b => b.Id), booked, a => a.BayId)).ToHashSet();
                var freeTechnicianIds = AvailabilityCalculator.FreeResourcesAt(slot, Busy(technicians.Select(t => t.Id), booked, a => a.TechnicianId)).ToHashSet();
                var load = Load(booked);
                var bay = AllocationPolicy.ChooseBay(
                    bays.Where(b => freeBayIds.Contains(b.Id) && b.Supports(serviceType)).ToList(), serviceType, load, preferredBayId: null);
                var technician = AllocationPolicy.ChooseTechnician(
                    technicians.Where(t => freeTechnicianIds.Contains(t.Id) && t.IsCertifiedFor(serviceType)).ToList(), serviceType, load, preferredTechnicianId: null);
                if (bay is null || technician is null)
                {
                    continue;
                }

                var customer = Customers[((dayIndex * DailyPattern.Length) + i) % Customers.Length];
                booked.Add(Appointment.Book(
                    ids[i], dealership, serviceType, bay, technician, slot, window,
                    new CustomerDetails(customer.Name, customer.Email, customer.Phone),
                    new VehicleDetails(Vin.Create(customer.Vin), customer.Registration, customer.Make, customer.Model),
                    notes: null,
                    nowUtc));
            }

            created.AddRange(booked);
        }

        if (created.Count > 0)
        {
            db.Appointments.AddRange(created);
            await db.SaveChangesAsync(ct);
        }

        return created.Count;
    }

    public static Guid AppointmentId(DateOnly localDate, string serviceCode) =>
        DeterministicGuid.Create(string.Create(CultureInfo.InvariantCulture, $"appointment:{localDate:yyyy-MM-dd}:{serviceCode}"));

    private static List<ResourceBusy> Busy(IEnumerable<Guid> resourceIds, List<Appointment> booked, Func<Appointment, Guid> resourceOf) =>
        resourceIds.Select(id => new ResourceBusy(id, booked.Where(a => resourceOf(a) == id).Select(a => a.Slot).ToList())).ToList();

    private static Dictionary<Guid, int> Load(List<Appointment> booked)
    {
        var load = new Dictionary<Guid, int>();
        foreach (var appointment in booked)
        {
            load[appointment.BayId] = load.GetValueOrDefault(appointment.BayId) + 1;
            load[appointment.TechnicianId] = load.GetValueOrDefault(appointment.TechnicianId) + 1;
        }

        return load;
    }
}

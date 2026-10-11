using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Microsoft.EntityFrameworkCore;
using static Keyloop.ServiceScheduler.Api.Domain.Resources.BayCapability;
using static Keyloop.ServiceScheduler.Api.Domain.Resources.Certification;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Seeding;

/// <summary>
/// The reference catalogue: two dealerships with their bays and technicians, and the service types (SYSTEM_DESIGN A-14: ids are
/// deterministic, <c>DeterministicGuid.Create("&lt;kind&gt;:&lt;slug&gt;")</c>, so demos and tests can address them).
/// </summary>
public static class ReferenceDataSeed
{
    public static readonly Guid ReadingDealershipId = DeterministicGuid.Create("dealership:reading");

    public static readonly Guid MunichDealershipId = DeterministicGuid.Create("dealership:munich");

    public static Guid ServiceTypeId(string code) => DeterministicGuid.Create($"service-type:{code}");

    public static Guid BayId(string dealershipSlug, int number) => DeterministicGuid.Create($"bay:{dealershipSlug}:{number}");

    public static Guid TechnicianId(string employeeNumber) => DeterministicGuid.Create($"technician:{employeeNumber}");

    /// <summary>Adds the catalogue when the database has no dealership yet; otherwise does nothing.</summary>
    /// <returns>The number of rows added (0 when already seeded).</returns>
    public static async Task<int> EnsureSeededAsync(SchedulerDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        if (await db.Dealerships.AnyAsync(ct))
        {
            return 0;
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var reading = Dealership.Create(
            ReadingDealershipId, "Keyloop Motors Reading", "Europe/London",
            OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0), saturdayCloses: new TimeOnly(13, 0)), now);
        var munich = Dealership.Create(
            MunichDealershipId, "Keyloop Autohaus München", "Europe/Berlin",
            OperatingHours.MondayToFriday(new TimeOnly(7, 30), new TimeOnly(18, 30)), now);

        ServiceBay[] bays =
        [
            Bay(reading, "reading", 1, "Bay 1 - Standard", StandardLift),
            Bay(reading, "reading", 2, "Bay 2 - Alignment", StandardLift, BayCapability.WheelAlignment),
            Bay(reading, "reading", 3, "Bay 3 - Heavy duty", HeavyDutyLift, StandardLift),
            Bay(reading, "reading", 4, "Bay 4 - EV", EvHighVoltage, StandardLift),
            Bay(reading, "reading", 5, "Bay 5 - Diagnostics", StandardLift, BayCapability.Diagnostics, BayCapability.AirConditioning),
            Bay(reading, "reading", 6, "Bay 6 - MOT", StandardLift, MotTesting),
            Bay(munich, "munich", 1, "Halle 1", StandardLift),
            Bay(munich, "munich", 2, "Halle 2", StandardLift, EvHighVoltage),
            Bay(munich, "munich", 3, "Halle 3", HeavyDutyLift, StandardLift),
        ];

        Technician[] technicians =
        [
            Tech(reading, "Amelia Clarke", "T-1001", GeneralService, Brakes, MotTester),
            Tech(reading, "Ben Okafor", "T-1002", GeneralService, HighVoltageElectrical, Certification.Diagnostics),
            Tech(reading, "Chloe Nguyen", "T-1003", GeneralService, Certification.WheelAlignment, Brakes),
            Tech(reading, "Daniel Moss", "T-1004", GeneralService, HeavyVehicle, Brakes),
            Tech(reading, "Eva Lindqvist", "T-1005", GeneralService, Certification.AirConditioning, Certification.Diagnostics),
            Tech(reading, "Farid Haddad", "T-1006", GeneralService, MotTester, Certification.Diagnostics),
            Tech(munich, "Greta Vogel", "M-2001", GeneralService, Brakes),
            Tech(munich, "Hans Richter", "M-2002", GeneralService, HighVoltageElectrical),
            Tech(munich, "Ingrid Bauer", "M-2003", GeneralService, HeavyVehicle, Certification.Diagnostics),
        ];

        ServiceType[] serviceTypes =
        [
            Service("INTERIM-SERVICE", "Interim Service", 60, [StandardLift], [GeneralService]),
            Service("FULL-SERVICE", "Full Service", 120, [StandardLift], [GeneralService]),
            Service("MOT-TEST", "MOT Test", 45, [MotTesting], [MotTester]),
            Service("BRAKES-PADS-DISCS", "Brake Pads & Discs", 90, [StandardLift], [Brakes]),
            Service("EV-BATTERY-CHECK", "EV Battery Health Check", 60, [EvHighVoltage], [HighVoltageElectrical]),
            // Reading has no bay with both EV and diagnostics equipment, so the diagnostics requirement sits on the technician.
            Service("EV-CHARGING-FAULT", "EV Charging Fault Diagnosis", 90, [EvHighVoltage], [HighVoltageElectrical, Certification.Diagnostics]),
            Service("WHEEL-ALIGNMENT", "Four-Wheel Alignment", 45, [BayCapability.WheelAlignment], [Certification.WheelAlignment]),
            Service("HEAVY-VAN-SERVICE", "Heavy Van Service", 180, [HeavyDutyLift], [HeavyVehicle]),
            Service("AIRCON-REGAS", "Air-Con Regas", 60, [BayCapability.AirConditioning], [Certification.AirConditioning]),
            Service("DIAG-FAULT-FINDING", "Diagnostic Fault Finding", 60, [BayCapability.Diagnostics], [Certification.Diagnostics]),
        ];

        db.Dealerships.AddRange(reading, munich);
        db.ServiceBays.AddRange(bays);
        db.Technicians.AddRange(technicians);
        db.ServiceTypes.AddRange(serviceTypes);
        await db.SaveChangesAsync(ct);
        return 2 + bays.Length + technicians.Length + serviceTypes.Length;
    }

    private static ServiceBay Bay(Dealership dealership, string slug, int number, string name, params BayCapability[] capabilities) =>
        ServiceBay.Create(BayId(slug, number), dealership.Id, name, capabilities);

    private static Technician Tech(Dealership dealership, string name, string employeeNumber, params Certification[] certifications) =>
        Technician.Create(TechnicianId(employeeNumber), dealership.Id, name, employeeNumber, certifications);

    private static ServiceType Service(string code, string name, int minutes, BayCapability[] capabilities, Certification[] certifications) =>
        ServiceType.Create(ServiceTypeId(code), code, name, ServiceDuration.Create(minutes), capabilities, certifications);
}

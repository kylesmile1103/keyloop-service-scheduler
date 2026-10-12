using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;
using static Keyloop.ServiceScheduler.Domain.Resources.BayCapability;
using static Keyloop.ServiceScheduler.Domain.Resources.Certification;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

/// <summary>
/// The reference catalogue: two dealerships with their bays and technicians, and the service types (ARCHITECTURE A-14: ids are
/// deterministic, <c>DeterministicGuid.Create("&lt;kind&gt;:&lt;slug&gt;")</c>, so demos and tests can address them).
/// </summary>
public static class ReferenceDataSeed
{
    public static readonly Guid ReadingDealershipId = DeterministicGuid.Create("dealership:reading");

    public static readonly Guid MunichDealershipId = DeterministicGuid.Create("dealership:munich");

    public static Guid ServiceTypeId(string code) => DeterministicGuid.Create($"service-type:{code}");

    public static Guid BayId(string dealershipSlug, int number) => DeterministicGuid.Create($"bay:{dealershipSlug}:{number}");

    public static Guid TechnicianId(string employeeNumber) => DeterministicGuid.Create($"technician:{employeeNumber}");

    /// <summary>
    /// Seeds an empty database; on an existing one, adds the missing damage-assessment service and versions the policy upgrade without
    /// changing existing resources or bookings. The upgrade is one-shot per dealership: once any stored version contains
    /// <see cref="RequirementRule.PostCollisionRuleCode"/>, a later version without it is a person's decision and stays the latest.
    /// It logs nothing: the caller logs <see cref="ReferenceSeedResult.LogPublished"/> after its transaction commits.
    /// </summary>
    /// <returns>The rows added (0 when already seeded) and the policy versions published on an existing database.</returns>
    public static async Task<ReferenceSeedResult> EnsureSeededAsync(SchedulerDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        if (await db.Dealerships.AnyAsync(ct))
        {
            if (!await db.ServiceTypes.AnyAsync(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT", ct))
            {
                db.ServiceTypes.Add(CreateServiceTypes().Single(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT"));
            }
            // Copy the latest policy before adding the new constraint. Old versions and custom effects are retained.
            var sites = await db.Dealerships.Select(d => d.Id).ToListAsync(ct);
            var policies = await db.RequirementRules.AsNoTracking().ToListAsync(ct);
            var published = new List<PublishedRequirementPolicy>();
            foreach (var site in sites)
            {
                var existing = policies.Where(r => r.DealershipId == site).ToArray();
                if (existing.Length == 0)
                {
                    db.RequirementRules.AddRange(RequirementRule.DefaultPolicy(site));
                    published.Add(new(site, RequirementRule.DefaultPolicyVersion, 0));
                    continue;
                }
                // Any version, not only the latest: a version published after the rule arrived and without it is an intentional removal.
                if (existing.Any(r => r.Code == RequirementRule.PostCollisionRuleCode))
                {
                    continue;
                }
                var version = existing.Max(r => r.PolicyVersion);
                var latest = existing.Where(r => r.PolicyVersion == version).ToArray();
                var collision = RequirementRule.DefaultPolicy(site).Single(r => r.Code == RequirementRule.PostCollisionRuleCode);
                db.RequirementRules.AddRange(latest.Append(collision).Select(r => r with
                {
                    Id = DeterministicGuid.Create($"requirement-rule:{site}:{version + 1}:{r.Code}"), PolicyVersion = version + 1,
                }));
                published.Add(new(site, version + 1, version));
            }
            return new(await db.SaveChangesAsync(ct), published);
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
            Tech(reading, "Eva Lindqvist", "T-1005", GeneralService, Certification.AirConditioning, Certification.Diagnostics, DamageAssessment),
            Tech(reading, "Farid Haddad", "T-1006", GeneralService, MotTester, Certification.Diagnostics),
            Tech(munich, "Greta Vogel", "M-2001", GeneralService, Brakes),
            Tech(munich, "Hans Richter", "M-2002", GeneralService, HighVoltageElectrical, DamageAssessment),
            Tech(munich, "Ingrid Bauer", "M-2003", GeneralService, HeavyVehicle, Certification.Diagnostics),
        ];

        var serviceTypes = CreateServiceTypes();

        db.Dealerships.AddRange(reading, munich);
        db.ServiceBays.AddRange(bays);
        db.Technicians.AddRange(technicians);
        db.ServiceTypes.AddRange(serviceTypes);
        db.RequirementRules.AddRange(RequirementRule.DefaultPolicy(reading.Id));
        db.RequirementRules.AddRange(RequirementRule.DefaultPolicy(munich.Id));
        return new(await db.SaveChangesAsync(ct), []);
    }

    internal static ServiceType[] CreateServiceTypes() =>
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
            Service("ACCIDENT-DAMAGE-ASSESSMENT", "Accident Damage Assessment", 60, [StandardLift], [DamageAssessment]),
        ];


    private static ServiceBay Bay(Dealership dealership, string slug, int number, string name, params BayCapability[] capabilities) =>
        ServiceBay.Create(BayId(slug, number), dealership.Id, name, capabilities);

    private static Technician Tech(Dealership dealership, string name, string employeeNumber, params Certification[] certifications) =>
        Technician.Create(TechnicianId(employeeNumber), dealership.Id, name, employeeNumber, certifications,
            hvLevel: SeededHvLevel(employeeNumber), hvLevelValidUntil: SeededHvLevelValidUntil, hvLevelConfirmed: true,
            brandSpecialisms: SeededBrands(dealership.Id));

    /// <summary>The seeded technicians' employee numbers, at Reading then Munich.</summary>
    private static readonly string[] SeededEmployeeNumbers = ["T-1001", "T-1002", "T-1003", "T-1004", "T-1005", "T-1006", "M-2001", "M-2002", "M-2003"];

    private static readonly DateOnly SeededHvLevelValidUntil = new(2028, 12, 31);

    private static int SeededHvLevel(string employeeNumber) => employeeNumber switch { "T-1002" or "T-1005" or "M-2002" => 3, "T-1006" => 1, _ => 2 };

    private static string[] SeededBrands(Guid dealershipId) => dealershipId == ReadingDealershipId ? ["VOLKSWAGEN"] : ["BMW"];

    /// <summary>
    /// Demo reseed only (never startup): gives each seeded technician whose HV level nobody confirmed the seeded, confirmed competence.
    /// A database seeded before vehicle-aware requirements keeps its technicians through migration and startup seeding, with the legacy
    /// HV certification as level 3 unconfirmed and every other level 0, so Unknown brake and MOT work would have no qualified technician
    /// once the flag is on. A confirmed level is a person's decision and is kept; technicians outside the seed are never touched.
    /// </summary>
    /// <returns>The number of technicians restored.</returns>
    public static async Task<int> RestoreSeededCompetenceAsync(SchedulerDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        var ids = SeededEmployeeNumbers.Select(TechnicianId).ToArray();
        var unconfirmed = (await db.Technicians.Where(t => ids.Contains(t.Id) && !t.HvLevelConfirmed).ToListAsync(ct))
            .Where(t => SeededEmployeeNumbers.Contains(t.EmployeeNumber, StringComparer.Ordinal)).ToList();
        foreach (var technician in unconfirmed)
        {
            technician.SetCompetence(SeededHvLevel(technician.EmployeeNumber), SeededHvLevelValidUntil, confirmed: true, SeededBrands(technician.DealershipId));
        }

        await db.SaveChangesAsync(ct);
        return unconfirmed.Count;
    }

    /// <summary>Demo reseed only: add the seeded damage qualification, preserving every other certification and confirmed HV level.</summary>
    public static async Task<int> RestoreSeededDamageCertificationAsync(SchedulerDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        var ids = new[] { TechnicianId("T-1005"), TechnicianId("M-2002") };
        var technicians = await db.Technicians.Where(t => ids.Contains(t.Id)).ToListAsync(ct);
        var restored = technicians.Where(t =>
            ((t.Id == TechnicianId("T-1005") && t.EmployeeNumber == "T-1005" && t.DealershipId == ReadingDealershipId) ||
             (t.Id == TechnicianId("M-2002") && t.EmployeeNumber == "M-2002" && t.DealershipId == MunichDealershipId)) &&
            !t.Certifications.Contains(DamageAssessment)).ToArray();
        foreach (var technician in restored)
        {
            technician.GrantCertification(DamageAssessment);
        }
        await db.SaveChangesAsync(ct);
        return restored.Length;
    }

    private static ServiceType Service(string code, string name, int minutes, BayCapability[] capabilities, Certification[] certifications) =>
        ServiceType.Create(ServiceTypeId(code), code, name, ServiceDuration.Create(minutes), capabilities, certifications);
}

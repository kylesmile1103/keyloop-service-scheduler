using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

/// <summary>
/// The resolver's safety semantics pinned by hand-written expectations: the property tests compare the resolver only with itself, so a
/// regression in the maximum, the unions, the heavy-vehicle condition, the legacy level-3 floor or the rule order would pass them.
/// Services are the seeded catalogue; the policy is the seeded default. Every expected value below is written out, never computed.
/// </summary>
public sealed class VehicleAwareRequirementTests
{
    private static readonly Guid Site = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly DateOnly Day = new(2026, 10, 13);

    public static TheoryData<Powertrain, VehicleClass, string, bool, int, string, string, string> ResolutionTable => new()
    {
        // The heavy-vehicle rule (order 50, level 0) fires after hv-routine (order 20, level 2): the minimum is the maximum, not the last.
        { Powertrain.BatteryElectric, VehicleClass.Heavy, "BRAKES-PADS-DISCS", false, 2, "StandardLift,HeavyDutyLift", "Brakes,HeavyVehicle", "hv-routine,heavy-vehicle" },
        // The legacy HighVoltageElectrical certification is a level 3 floor on component work, even for a declared ICE vehicle, and is
        // named first in the explanation so that a level 3 minimum on an ICE vehicle is never unexplained.
        { Powertrain.Ice, VehicleClass.Car, "EV-BATTERY-CHECK", false, 3, "EvHighVoltage", "", "legacy-hv-component" },
        { Powertrain.Unknown, VehicleClass.Unknown, "EV-BATTERY-CHECK", false, 3, "EvHighVoltage", "", "legacy-hv-component,hv-components" },
        { Powertrain.BatteryElectric, VehicleClass.Car, "EV-CHARGING-FAULT", false, 3, "EvHighVoltage", "Diagnostics", "legacy-hv-component,hv-components" },
        { Powertrain.Unknown, VehicleClass.Heavy, "INTERIM-SERVICE", false, 2, "StandardLift,HeavyDutyLift", "GeneralService,HeavyVehicle", "hv-routine,heavy-vehicle" },
        { Powertrain.Ice, VehicleClass.Heavy, "MOT-TEST", false, 0, "MotTesting,HeavyDutyLift", "MotTester,HeavyVehicle", "heavy-vehicle" },
        { Powertrain.Ice, VehicleClass.Heavy, "HEAVY-VAN-SERVICE", false, 0, "HeavyDutyLift", "HeavyVehicle", "heavy-vehicle" },
        { Powertrain.Unknown, VehicleClass.Unknown, "HEAVY-VAN-SERVICE", false, 2, "HeavyDutyLift", "HeavyVehicle", "hv-routine" },
        { Powertrain.Ice, VehicleClass.Car, "INTERIM-SERVICE", false, 0, "StandardLift", "GeneralService", "" },
        { Powertrain.Ice, VehicleClass.LightCommercial, "BRAKES-PADS-DISCS", false, 0, "StandardLift", "Brakes", "" },
        { Powertrain.MildHybrid, VehicleClass.Car, "WHEEL-ALIGNMENT", false, 1, "WheelAlignment", "WheelAlignment", "hv-awareness" },
        { Powertrain.FullHybrid, VehicleClass.Car, "MOT-TEST", false, 1, "MotTesting", "MotTester", "hv-awareness" },
        { Powertrain.PluginHybrid, VehicleClass.LightCommercial, "AIRCON-REGAS", false, 3, "AirConditioning", "AirConditioning", "hv-aircon" },
        { Powertrain.FuelCell, VehicleClass.Car, "FULL-SERVICE", false, 2, "StandardLift", "GeneralService", "hv-routine" },
        // Live HV work is explicit: level 4 and an EV bay whatever the declared powertrain, added after every other rule.
        { Powertrain.Ice, VehicleClass.Car, "INTERIM-SERVICE", true, 4, "StandardLift,EvHighVoltage", "GeneralService", "hv-live-diagnosis" },
        { Powertrain.FuelCell, VehicleClass.Car, "DIAG-FAULT-FINDING", true, 4, "Diagnostics,EvHighVoltage", "Diagnostics", "hv-routine,hv-live-diagnosis" },
        { Powertrain.FullHybrid, VehicleClass.Heavy, "EV-CHARGING-FAULT", true, 4, "EvHighVoltage,HeavyDutyLift", "Diagnostics,HeavyVehicle", "legacy-hv-component,hv-components,heavy-vehicle,hv-live-diagnosis" },
    };

    [Theory]
    [MemberData(nameof(ResolutionTable))]
    public void Default_policy_resolves_the_documented_requirements(Powertrain powertrain, VehicleClass vehicleClass, string serviceCode, bool live,
        int minimum, string bays, string certifications, string firedRules)
    {
        var service = ReferenceDataSeed.CreateServiceTypes().Single(s => s.Code == serviceCode);
        var profile = VehicleProfile.Unknown with { Powertrain = powertrain, VehicleClass = vehicleClass };

        var requirements = RequirementResolver.Resolve(service, profile, RequirementRule.DefaultPolicy(Site), live);

        requirements.MinimumHvLevel.ShouldBe(minimum);
        requirements.BayCapabilities.ShouldBe(Parse<BayCapability>(bays), ignoreOrder: true);
        requirements.Certifications.ShouldBe(Parse<Certification>(certifications), ignoreOrder: true);
        requirements.FiredRules.ShouldBe(Split(firedRules));
        requirements.PolicyVersion.ShouldBe(1);
    }

    [Fact]
    public void Rule_order_decides_the_fired_sequence_not_the_input_order()
    {
        var service = ReferenceDataSeed.CreateServiceTypes().Single(s => s.Code == "EV-CHARGING-FAULT");
        var profile = VehicleProfile.Unknown with { VehicleClass = VehicleClass.Heavy };
        var reversed = RequirementRule.DefaultPolicy(Site).Reverse().ToArray();

        RequirementResolver.Resolve(service, profile, reversed, needsLiveDiagnosis: true).FiredRules
            .ShouldBe(["legacy-hv-component", "hv-components", "heavy-vehicle", "hv-live-diagnosis"]);
    }

    [Theory]
    [InlineData(2, 2, true, true)]
    [InlineData(2, 3, true, true)]
    [InlineData(3, 2, true, false)]
    [InlineData(0, 0, false, false)]
    public void Technician_qualification_needs_activity_every_certification_and_the_level(int minimum, int level, bool active, bool expected)
    {
        var requirements = new JobRequirements(new HashSet<BayCapability>(), new HashSet<Certification> { Certification.Brakes }, minimum, 1, []);
        var technician = Technician.Create(Id(10), Site, "A", "A", [Certification.Brakes, Certification.GeneralService], isActive: active,
            hvLevel: level, hvLevelValidUntil: Day, hvLevelConfirmed: true);

        technician.Satisfies(requirements, Day).ShouldBe(expected);
        Technician.Create(Id(11), Site, "B", "B", [Certification.GeneralService], hvLevel: 4, hvLevelConfirmed: true)
            .Satisfies(requirements, Day).ShouldBeFalse("a missing certification is never compensated by a higher level");
    }

    [Theory]
    [InlineData(-1, 3)]
    [InlineData(0, 3)]
    [InlineData(1, 0)]
    public void Expiry_is_inclusive_and_a_lapsed_level_counts_as_zero(int daysSinceExpiry, int effective)
    {
        var technician = Technician.Create(Id(10), Site, "A", "A", [], hvLevel: 3, hvLevelValidUntil: Day.AddDays(-daysSinceExpiry), hvLevelConfirmed: true);
        technician.EffectiveHvLevel(Day).ShouldBe(effective);
        Technician.Create(Id(11), Site, "B", "B", [], hvLevel: 3).EffectiveHvLevel(DateOnly.MaxValue).ShouldBe(3, "no expiry never lapses");
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void Bay_qualification_needs_activity_and_every_capability(bool active, bool expected)
    {
        var requirements = new JobRequirements(new HashSet<BayCapability> { BayCapability.StandardLift, BayCapability.HeavyDutyLift },
            new HashSet<Certification>(), 0, 1, []);
        ServiceBay.Create(Id(1), Site, "Heavy", [BayCapability.StandardLift, BayCapability.HeavyDutyLift], active).Satisfies(requirements).ShouldBe(expected);
        ServiceBay.Create(Id(2), Site, "Standard", [BayCapability.StandardLift]).Satisfies(requirements).ShouldBeFalse();
    }

    private static T[] Parse<T>(string csv) where T : struct, Enum => [.. Split(csv).Select(Enum.Parse<T>)];

    private static string[] Split(string csv) => csv.Length == 0 ? [] : csv.Split(',');

    private static Guid Id(int value) => new(value, 0, 0, new byte[8]);
}

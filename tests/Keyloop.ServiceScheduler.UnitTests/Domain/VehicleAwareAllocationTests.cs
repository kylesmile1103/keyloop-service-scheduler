using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public sealed class VehicleAwareAllocationTests
{
    private static readonly Guid Site = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly DateOnly Day = new(2026, 10, 13);
    private static readonly ServiceType Service = ServiceType.Create(Guid.NewGuid(), "BRAKES-PADS-DISCS", "Brakes", ServiceDuration.Create(60),
        [BayCapability.StandardLift], [Certification.Brakes]);

    [Theory]
    [InlineData(1729)]
    [InlineData(3101)]
    [InlineData(3102)]
    public void Generated_allocations_satisfy_requirements_and_resolution_is_order_stable(int seed)
    {
        var random = new Random(seed);
        var allocations = 0;
        for (var trial = 0; trial < 500; trial++)
        {
            var profile = VehicleProfile.Unknown with { Powertrain = (Powertrain)random.Next(7), VehicleClass = (VehicleClass)random.Next(4) };
            var code = RequirementRule.HvServiceCodes[random.Next(RequirementRule.HvServiceCodes.Count)];
            var service = ServiceType.Create(Id(90), code, code, ServiceDuration.Create(60), [BayCapability.StandardLift], [Certification.Brakes]);
            var rules = RequirementRule.DefaultPolicy(Site).Select(rule => rule with
            {
                MinimumHvLevel = random.Next(rule.MinimumHvLevel, 5),
                Powertrains = rule.Condition == RequirementCondition.VehicleClass ? [] : [(Powertrain)random.Next(1, 6)],
            }).ToArray();
            var live = random.Next(2) == 0;
            var requirements = RequirementResolver.Resolve(service, profile, rules, live);
            var shuffled = rules.OrderBy(_ => random.Next()).ToArray();
            var again = RequirementResolver.Resolve(service, profile, shuffled, live);
            again.MinimumHvLevel.ShouldBe(requirements.MinimumHvLevel);
            again.BayCapabilities.ShouldBe(requirements.BayCapabilities, ignoreOrder: true);
            again.Certifications.ShouldBe(requirements.Certifications, ignoreOrder: true);
            again.FiredRules.ShouldBe(requirements.FiredRules);
            var unknown = RequirementResolver.Resolve(service, profile with { Powertrain = Powertrain.Unknown }, rules, live);
            for (var powertrain = 1; powertrain <= 5; powertrain++)
            {
                var concrete = RequirementResolver.Resolve(service, profile with { Powertrain = (Powertrain)powertrain }, rules, live);
                unknown.MinimumHvLevel.ShouldBeGreaterThanOrEqualTo(concrete.MinimumHvLevel);
                concrete.BayCapabilities.IsSubsetOf(unknown.BayCapabilities).ShouldBeTrue();
                concrete.Certifications.IsSubsetOf(unknown.Certifications).ShouldBeTrue();
            }
            var bays = Enumerable.Range(1, 5).Select(i => ServiceBay.Create(Id(i), Site, $"Bay {i}",
                random.Next(2) == 0 ? [BayCapability.StandardLift] : [BayCapability.StandardLift, BayCapability.EvHighVoltage, BayCapability.HeavyDutyLift])).ToArray();
            var technicians = Enumerable.Range(10, 8).Select(i => Technician.Create(Id(i), Site, $"Tech {i}", $"T{i}",
                random.Next(2) == 0 ? [Certification.Brakes] : [Certification.Brakes, Certification.HeavyVehicle],
                hvLevel: random.Next(5), hvLevelValidUntil: Day.AddDays(random.Next(-1, 2)), hvLevelConfirmed: random.Next(2) == 0)).ToArray();
            var result = AllocationPolicy.Allocate(bays, technicians, requirements, Day, new HashSet<Guid>(), new HashSet<Guid>(), new Dictionary<Guid, int>(), null, null);
            if (result is not null)
            {
                allocations++;
                result.Bay.Satisfies(requirements).ShouldBeTrue($"seed {seed}, trial {trial}");
                result.Technician.Satisfies(requirements, Day).ShouldBeTrue($"seed {seed}, trial {trial}");
                var reversed = AllocationPolicy.Allocate(bays.Reverse().ToArray(), technicians.Reverse().ToArray(), requirements, Day,
                    new HashSet<Guid>(), new HashSet<Guid>(), new Dictionary<Guid, int>(), null, null).ShouldNotBeNull();
                reversed.Technician.Id.ShouldBe(result.Technician.Id);
                reversed.Decision.DecidedBy.ShouldBe(result.Decision.DecidedBy);
                reversed.Decision.Reasons.ShouldBe(result.Decision.Reasons);
            }
        }
        allocations.ShouldBeGreaterThan(0, $"seed {seed} must exercise feasible allocations");
    }

    [Fact]
    public void Unknown_is_at_least_as_constrained_as_every_concrete_HV_powertrain()
    {
        foreach (var code in RequirementRule.HvServiceCodes)
        {
            foreach (var live in new[] { false, true })
            {
                foreach (var vehicleClass in new[] { VehicleClass.Car, VehicleClass.Heavy })
                {
                    var service = ServiceType.Create(Id(90), code, code, ServiceDuration.Create(60), [BayCapability.StandardLift], [Certification.GeneralService]);
                    var unknown = RequirementResolver.Resolve(service, VehicleProfile.Unknown with { VehicleClass = vehicleClass }, RequirementRule.DefaultPolicy(Site), live);
                    foreach (var powertrain in new[] { Powertrain.MildHybrid, Powertrain.FullHybrid, Powertrain.PluginHybrid, Powertrain.BatteryElectric, Powertrain.FuelCell })
                    {
                        var concrete = RequirementResolver.Resolve(service, VehicleProfile.Unknown with { Powertrain = powertrain, VehicleClass = vehicleClass },
                            RequirementRule.DefaultPolicy(Site), live);
                        unknown.MinimumHvLevel.ShouldBeGreaterThanOrEqualTo(concrete.MinimumHvLevel);
                        concrete.BayCapabilities.IsSubsetOf(unknown.BayCapabilities).ShouldBeTrue();
                        concrete.Certifications.IsSubsetOf(unknown.Certifications).ShouldBeTrue();
                    }
                }
            }
        }
    }

    public static TheoryData<int, int, AllocationCriterion> GoldenCases => new(
        Enumerable.Range(0, 40).Select(i => new TheoryDataRow<int, int, AllocationCriterion>(i, i % 8 is 0 or 3 ? 11 : 10,
            (i % 8) switch
            {
                0 => AllocationCriterion.PreferredResource,
                1 => AllocationCriterion.SurplusCompetences,
                2 => AllocationCriterion.LowestLoad,
                3 => AllocationCriterion.Name,
                4 => AllocationCriterion.Id,
                _ => AllocationCriterion.OnlyQualifiedResource,
            })));

    [Theory]
    [MemberData(nameof(GoldenCases))]
    public void Golden_allocation_table(int scenario, int expected, AllocationCriterion decidedBy)
    {
        var kind = scenario % 8;
        var hv = scenario / 8;
        var requirements = new JobRequirements(new HashSet<BayCapability> { BayCapability.StandardLift }, new HashSet<Certification> { Certification.Brakes }, hv, 1, []);
        var bay = ServiceBay.Create(Id(1), Site, "Bay", [BayCapability.StandardLift]);
        var first = Technician.Create(Id(kind == 3 ? 11 : 10), Site, kind == 4 ? "Same" : kind is 1 or 2 ? "Z" : "A", "A", [Certification.Brakes], hvLevel: hv, hvLevelConfirmed: true);
        var second = Technician.Create(Id(kind == 3 ? 10 : 11), Site, kind == 4 ? "Same" : kind is 1 or 2 ? "A" : "B", "B",
            kind == 1 && hv == 4 ? [Certification.Brakes, Certification.Diagnostics] : [Certification.Brakes],
            hvLevel: kind == 1 && hv < 4 ? hv + 1 : hv, hvLevelValidUntil: kind == 7 ? Day.AddDays(-1) : null, hvLevelConfirmed: true, isActive: kind != 6);
        var busy = kind == 5 ? new HashSet<Guid> { second.Id } : new HashSet<Guid>();
        // At level zero expiry has no effect; a busy second still exercises the single-candidate criterion.
        if (kind == 7 && hv == 0)
        {
            busy.Add(second.Id);
        }

        var load = new Dictionary<Guid, int> { [first.Id] = 0, [second.Id] = kind == 2 ? 1 : 0 };
        var result = AllocationPolicy.Allocate([bay], [second, first], requirements, Day, new HashSet<Guid>(), busy, load, null, kind == 0 ? second.Id : null).ShouldNotBeNull();
        result.Technician.Id.ShouldBe(Id(expected));
        result.Decision.DecidedBy.ShouldBe(decidedBy);
    }

    [Fact]
    public void An_ICE_declaration_cannot_relax_explicit_live_HV_work()
    {
        var requirements = RequirementResolver.Resolve(Service, VehicleProfile.Unknown with { Powertrain = Powertrain.Ice },
            RequirementRule.DefaultPolicy(Site), needsLiveDiagnosis: true);
        requirements.MinimumHvLevel.ShouldBe(4);
        requirements.BayCapabilities.ShouldContain(BayCapability.EvHighVoltage);
        requirements.FiredRules.ShouldContain("hv-live-diagnosis");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(5)]
    public void Rejects_invalid_HV_levels(int level) => Should.Throw<ArgumentOutOfRangeException>(() =>
        Technician.Create(Id(10), Site, "A", "A", [], hvLevel: level));

    [Fact]
    public void Expiry_is_inclusive_and_unconfirmed_levels_count()
    {
        var requirements = new JobRequirements(new HashSet<BayCapability>(), new HashSet<Certification>(), 3, 1, []);
        var technician = Technician.Create(Id(10), Site, "A", "A", [], hvLevel: 3, hvLevelValidUntil: Day, hvLevelConfirmed: false);
        technician.Satisfies(requirements, Day).ShouldBeTrue();
        technician.Satisfies(requirements, Day.AddDays(1)).ShouldBeFalse();
    }

    private static Guid Id(int value) => new(value, 0, 0, new byte[8]);
}

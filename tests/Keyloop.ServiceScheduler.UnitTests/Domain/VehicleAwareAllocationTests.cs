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
        var allocatedCodes = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var trial = 0; trial < 500; trial++)
        {
            var profile = VehicleProfile.Unknown with { Powertrain = (Powertrain)random.Next(7), VehicleClass = (VehicleClass)random.Next(4) };
            var code = RequirementRule.HvServiceCodes[random.Next(RequirementRule.HvServiceCodes.Count)];
            var service = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes().Single(s => s.Code == code);
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
            // Random equipment from every capability; about half the bays also carry the service's own, so each code stays feasible
            // while rule-added capabilities (EV bay, heavy lift) are present only by chance.
            var bays = Enumerable.Range(1, 5).Select(i => ServiceBay.Create(Id(i), Site, $"Bay {i}",
                Enum.GetValues<BayCapability>().Where(_ => random.Next(2) == 0)
                    .Union(random.Next(2) == 0 ? service.RequiredBayCapabilities : []))).ToArray();
            var technicians = Enumerable.Range(10, 8).Select(i => Technician.Create(Id(i), Site, $"Tech {i}", $"T{i}",
                random.Next(2) == 0 ? [Certification.Brakes] : [.. Enum.GetValues<Certification>()],
                hvLevel: random.Next(5), hvLevelValidUntil: Day.AddDays(random.Next(-1, 2)), hvLevelConfirmed: random.Next(2) == 0)).ToArray();
            var result = AllocationPolicy.Allocate(bays, technicians, requirements, Day, new HashSet<Guid>(), new HashSet<Guid>(), new Dictionary<Guid, int>(), null, null);
            if (result is not null)
            {
                allocations++;
                allocatedCodes[code] = allocatedCodes.GetValueOrDefault(code) + 1;
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
        // Every service's own requirements must reach the allocator, not only those a generic lift can satisfy.
        RequirementRule.HvServiceCodes.Where(code => allocatedCodes.GetValueOrDefault(code) == 0)
            .ShouldBeEmpty($"seed {seed} never allocated these services");
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
                    var service = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes().Single(s => s.Code == code);
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

    [Theory]
    [InlineData(Powertrain.Ice, 13, 0, "")]
    [InlineData(Powertrain.BatteryElectric, 11, 3, "hv-post-collision")]
    [InlineData(Powertrain.Unknown, 11, 3, "hv-post-collision")]
    public void Damage_assessment_golden_allocation_requires_both_the_task_skill_and_HV_level(Powertrain powertrain, int expected, int minimum, string rule)
    {
        var service = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes()
            .Single(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT");
        var requirements = RequirementResolver.Resolve(service, VehicleProfile.Unknown with { Powertrain = powertrain }, RequirementRule.DefaultPolicy(Site));
        var bay = ServiceBay.Create(Id(1), Site, "Standard", [BayCapability.StandardLift]);
        var routine = Technician.Create(Id(10), Site, "A", "A", [Certification.DamageAssessment], hvLevel: 2);
        var collision = Technician.Create(Id(11), Site, "B", "B", [Certification.DamageAssessment], hvLevel: 3, hvLevelValidUntil: Day);
        var noTaskSkill = Technician.Create(Id(12), Site, "C", "C", [Certification.Diagnostics], hvLevel: 4);
        var expired = Technician.Create(Id(13), Site, "D", "D", [Certification.DamageAssessment], hvLevel: 3, hvLevelValidUntil: Day.AddDays(-1));
        var result = AllocationPolicy.Allocate([bay], [noTaskSkill, expired, collision, routine], requirements, Day,
            new HashSet<Guid>(), new HashSet<Guid>(), new Dictionary<Guid, int>(), null, null).ShouldNotBeNull();
        result.Technician.Id.ShouldBe(Id(expected));
        result.Decision.DecidedBy.ShouldBe(powertrain == Powertrain.Ice ? AllocationCriterion.SurplusCompetences : AllocationCriterion.OnlyQualifiedResource);
        result.Decision.MinimumHvLevel.ShouldBe(minimum);
        result.Decision.FiredRules.ShouldBe(rule.Length == 0 ? [] : [rule]);
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

    public static TheoryData<string, int, AllocationCriterion> BayGoldenCases => new()
    {
        { "surplus", 1, AllocationCriterion.SurplusCompetences },
        { "load", 1, AllocationCriterion.LowestLoad },
        { "name", 2, AllocationCriterion.Name },
        { "id", 1, AllocationCriterion.Id },
        { "preferred", 2, AllocationCriterion.PreferredResource },
        { "only", 1, AllocationCriterion.OnlyQualifiedResource },
    };

    [Theory]
    [MemberData(nameof(BayGoldenCases))]
    public void Golden_bay_table(string scenario, int expected, AllocationCriterion bayDecidedBy)
    {
        var requirements = new JobRequirements(new HashSet<BayCapability> { BayCapability.StandardLift }, new HashSet<Certification> { Certification.Brakes }, 0, 1, []);
        // Bay 1 sorts after bay 2 by name unless the scenario's criterion says otherwise, so only that criterion can pick bay 1.
        var first = ServiceBay.Create(Id(1), Site, scenario == "id" ? "Same" : "B", [BayCapability.StandardLift]);
        var second = ServiceBay.Create(Id(2), Site, scenario == "id" ? "Same" : "A",
            scenario is "surplus" or "preferred" ? [BayCapability.StandardLift, BayCapability.EvHighVoltage] : [BayCapability.StandardLift]);
        var load = new Dictionary<Guid, int> { [second.Id] = scenario == "load" ? 1 : 0 };
        var busy = scenario == "only" ? new HashSet<Guid> { second.Id } : new HashSet<Guid>();
        var technician = Technician.Create(Id(10), Site, "A", "A", [Certification.Brakes]);

        var result = AllocationPolicy.Allocate([second, first], [technician], requirements, Day, busy, new HashSet<Guid>(), load,
            scenario == "preferred" ? second.Id : null, null).ShouldNotBeNull();

        result.Bay.Id.ShouldBe(Id(expected));
        result.Decision.BayDecidedBy.ShouldBe(bayDecidedBy);
        result.Decision.DecidedBy.ShouldBe(AllocationCriterion.OnlyQualifiedResource);
        result.Decision.Reasons.ShouldBeEmpty();
    }

    public static TheoryData<string, string> ReasonCases => new()
    {
        { "technician-not-at-dealership", "preferred-technician:not-at-dealership" },
        { "technician-inactive", "preferred-technician:inactive" },
        { "technician-missing-certifications", "preferred-technician:missing-certifications" },
        { "technician-minimum-hv-level", "preferred-technician:minimum-hv-level" },
        { "technician-hv-expired", "preferred-technician:hv-expired" },
        { "technician-busy", "preferred-technician:busy" },
        { "bay-not-at-dealership", "preferred-bay:not-at-dealership" },
        { "bay-inactive", "preferred-bay:inactive" },
        { "bay-missing-capabilities", "preferred-bay:missing-capabilities" },
        { "bay-busy", "preferred-bay:busy" },
    };

    /// <summary>A preferred resource that cannot be used leaves two equal candidates: the name decides, and one reason says why.</summary>
    [Theory]
    [MemberData(nameof(ReasonCases))]
    public void An_unusable_preference_is_explained_and_the_rest_are_compared(string scenario, string reason)
    {
        var requirements = new JobRequirements(new HashSet<BayCapability> { BayCapability.StandardLift }, new HashSet<Certification> { Certification.Brakes }, 2, 1, []);
        ServiceBay[] bays =
        [
            ServiceBay.Create(Id(1), Site, "A", [BayCapability.StandardLift]),
            ServiceBay.Create(Id(2), Site, "B", [BayCapability.StandardLift]),
            ServiceBay.Create(Id(3), Site, "C", scenario == "bay-missing-capabilities" ? [BayCapability.EvHighVoltage] : [BayCapability.StandardLift],
                isActive: scenario != "bay-inactive"),
        ];
        Technician[] technicians =
        [
            Technician.Create(Id(10), Site, "A", "A", [Certification.Brakes], hvLevel: 2, hvLevelConfirmed: true),
            Technician.Create(Id(11), Site, "B", "B", [Certification.Brakes], hvLevel: 2, hvLevelConfirmed: true),
            Technician.Create(Id(12), Site, "C", "C", scenario == "technician-missing-certifications" ? [Certification.GeneralService] : [Certification.Brakes],
                isActive: scenario != "technician-inactive", hvLevel: scenario switch { "technician-minimum-hv-level" => 1, "technician-hv-expired" => 3, _ => 2 },
                // Expired on the day before the appointment's local date; the inclusive bound itself is the next test.
                hvLevelValidUntil: scenario == "technician-hv-expired" ? Day.AddDays(-1) : null, hvLevelConfirmed: true),
        ];
        var busyBays = scenario == "bay-busy" ? new HashSet<Guid> { Id(3) } : new HashSet<Guid>();
        var busyTechnicians = scenario == "technician-busy" ? new HashSet<Guid> { Id(12) } : new HashSet<Guid>();
        Guid? preferredBay = scenario.StartsWith("bay-", StringComparison.Ordinal) ? scenario == "bay-not-at-dealership" ? Id(98) : Id(3) : null;
        Guid? preferredTechnician = scenario.StartsWith("technician-", StringComparison.Ordinal)
            ? scenario == "technician-not-at-dealership" ? Id(99) : Id(12) : null;

        var result = AllocationPolicy.Allocate(bays, technicians, requirements, Day, busyBays, busyTechnicians, new Dictionary<Guid, int>(),
            preferredBay, preferredTechnician).ShouldNotBeNull();

        result.Decision.Reasons.ShouldBe([reason]);
        result.Bay.Id.ShouldBe(Id(1));
        result.Technician.Id.ShouldBe(Id(10));
        result.Decision.BayDecidedBy.ShouldBe(AllocationCriterion.Name);
        result.Decision.DecidedBy.ShouldBe(AllocationCriterion.Name);
        result.Decision.PreferredBayId.ShouldBe(preferredBay);
        result.Decision.PreferredTechnicianId.ShouldBe(preferredTechnician);
    }

    [Fact]
    public void A_preferred_technician_whose_level_expires_on_the_appointment_date_is_still_chosen()
    {
        var requirements = new JobRequirements(new HashSet<BayCapability>(), new HashSet<Certification>(), 3, 1, []);
        var bay = ServiceBay.Create(Id(1), Site, "A", []);
        var other = Technician.Create(Id(10), Site, "A", "A", [], hvLevel: 3, hvLevelConfirmed: true);
        var preferred = Technician.Create(Id(11), Site, "B", "B", [], hvLevel: 3, hvLevelValidUntil: Day, hvLevelConfirmed: false);

        var result = AllocationPolicy.Allocate([bay], [other, preferred], requirements, Day, new HashSet<Guid>(), new HashSet<Guid>(),
            new Dictionary<Guid, int>(), null, preferred.Id).ShouldNotBeNull();

        result.Technician.Id.ShouldBe(preferred.Id);
        result.Decision.DecidedBy.ShouldBe(AllocationCriterion.PreferredResource);
        result.Decision.Reasons.ShouldBeEmpty();
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

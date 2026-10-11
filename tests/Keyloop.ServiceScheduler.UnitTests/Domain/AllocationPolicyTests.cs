using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using static Keyloop.ServiceScheduler.Api.Domain.Resources.BayCapability;
using static Keyloop.ServiceScheduler.Api.Domain.Resources.Certification;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class AllocationPolicyTests
{
    private static readonly Guid DealershipId = Guid.NewGuid();

    private static readonly Dictionary<Guid, int> NoLoad = [];

    // Requires StandardLift + GeneralService.
    private static readonly ServiceType Interim = ServiceType.Create(
        Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(60), [StandardLift], [GeneralService]);

    private static ServiceBay Bay(string name, params BayCapability[] capabilities) =>
        ServiceBay.Create(Guid.NewGuid(), DealershipId, name, capabilities);

    private static ServiceBay Bay(Guid id, string name, params BayCapability[] capabilities) =>
        ServiceBay.Create(id, DealershipId, name, capabilities);

    private static Technician Tech(string name, params Certification[] certifications) =>
        Technician.Create(Guid.NewGuid(), DealershipId, name, "T-1000", certifications);

    private static Technician Tech(Guid id, string name, params Certification[] certifications) =>
        Technician.Create(id, DealershipId, name, "T-1000", certifications);

    // The name tie-break tests use fixed ids assigned in reverse of name order, so an ordering that compared Id before Name would
    // always pick a different resource. Random ids let that mutant survive whenever they happened to sort like the names.
    private static Guid FixedId(int n) => Guid.Parse($"00000000-0000-0000-0000-{n:D12}");

    [Fact]
    public void Preferred_bay_wins_when_free()
    {
        var standard = Bay("Bay 1", StandardLift);
        var ev = Bay("Bay 2", StandardLift, EvHighVoltage);

        AllocationPolicy.ChooseBay([standard, ev], Interim, NoLoad, ev.Id).ShouldBeSameAs(ev);
    }

    [Fact]
    public void Preferred_bay_ignored_when_not_free()
    {
        var standard = Bay("Bay 1", StandardLift);
        var ev = Bay("Bay 2", StandardLift, EvHighVoltage);
        var busyPreferred = Bay("Bay 3", StandardLift);

        AllocationPolicy.ChooseBay([ev, standard], Interim, NoLoad, busyPreferred.Id).ShouldBeSameAs(standard);
        AllocationPolicy.ChooseBay([ev, standard], Interim, NoLoad, preferredBayId: null).ShouldBeSameAs(standard);
    }

    [Fact]
    public void Prefers_fewest_surplus_capabilities()
    {
        var ev = Bay("Bay A", StandardLift, EvHighVoltage);
        var standard = Bay("Bay Z", StandardLift);
        var load = new Dictionary<Guid, int> { [standard.Id] = 5 };

        // A standard service must not consume the EV bay, even when the standard bay is busier and sorts later by name.
        AllocationPolicy.ChooseBay([ev, standard], Interim, load, preferredBayId: null).ShouldBeSameAs(standard);
    }

    [Fact]
    public void Ties_broken_by_lower_load_then_name()
    {
        var bay1 = Bay(FixedId(3), "Bay 1", StandardLift);
        var bay2 = Bay(FixedId(2), "Bay 2", StandardLift);
        var bay3 = Bay(FixedId(1), "Bay 3", StandardLift);
        ServiceBay[] bays = [bay3, bay2, bay1];

        AllocationPolicy.ChooseBay(bays, Interim, new Dictionary<Guid, int> { [bay1.Id] = 2, [bay2.Id] = 1, [bay3.Id] = 0 }, null).ShouldBeSameAs(bay3);
        AllocationPolicy.ChooseBay(bays, Interim, new Dictionary<Guid, int> { [bay1.Id] = 2, [bay2.Id] = 1, [bay3.Id] = 1 }, null).ShouldBeSameAs(bay2);
        AllocationPolicy.ChooseBay(bays, Interim, new Dictionary<Guid, int> { [bay2.Id] = 1, [bay3.Id] = 1 }, null).ShouldBeSameAs(bay1); // missing load = 0
        AllocationPolicy.ChooseBay(bays, Interim, NoLoad, null).ShouldBeSameAs(bay1);

        // Ordinal, not culture or case-insensitive: 'B' (0x42) sorts before 'b' (0x62).
        var lower = Bay(FixedId(1), "bay A", StandardLift);
        var upper = Bay(FixedId(2), "Bay B", StandardLift);
        AllocationPolicy.ChooseBay([lower, upper], Interim, NoLoad, null).ShouldBeSameAs(upper);
    }

    [Fact]
    public void Final_bay_tie_break_is_id()
    {
        var first = Bay(FixedId(1), "Bay 1", StandardLift);
        var second = Bay(FixedId(2), "Bay 1", StandardLift);

        AllocationPolicy.ChooseBay([second, first], Interim, NoLoad, null).ShouldBeSameAs(first);
        AllocationPolicy.ChooseBay([first, second], Interim, NoLoad, null).ShouldBeSameAs(first);
    }

    [Fact]
    public void Returns_null_when_no_candidates()
    {
        AllocationPolicy.ChooseBay([], Interim, NoLoad, null).ShouldBeNull();
        AllocationPolicy.ChooseBay([], Interim, NoLoad, Guid.NewGuid()).ShouldBeNull();
    }

    [Fact]
    public void ChooseBay_validates_arguments()
    {
        ServiceBay[] bays = [Bay("Bay 1", StandardLift)];

        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseBay(null!, Interim, NoLoad, null)).ParamName.ShouldBe("freeCompatibleBays");
        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseBay(bays, null!, NoLoad, null)).ParamName.ShouldBe("serviceType");
        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseBay(bays, Interim, null!, null)).ParamName.ShouldBe("loadToday");
        Should.Throw<ArgumentException>(() => AllocationPolicy.ChooseBay([null!], Interim, NoLoad, null)).ParamName.ShouldBe("freeCompatibleBays");
    }

    [Fact]
    public void Preferred_technician_wins_when_free()
    {
        var generalist = Tech("Amelia Clarke", GeneralService);
        var evSpecialist = Tech("Ben Okafor", GeneralService, HighVoltageElectrical);

        AllocationPolicy.ChooseTechnician([generalist, evSpecialist], Interim, NoLoad, evSpecialist.Id).ShouldBeSameAs(evSpecialist);
    }

    [Fact]
    public void Preferred_technician_ignored_when_not_free()
    {
        var generalist = Tech("Amelia Clarke", GeneralService);
        var evSpecialist = Tech("Ben Okafor", GeneralService, HighVoltageElectrical);
        var busyPreferred = Tech("Chloe Davies", GeneralService);

        AllocationPolicy.ChooseTechnician([evSpecialist, generalist], Interim, NoLoad, busyPreferred.Id).ShouldBeSameAs(generalist);
        AllocationPolicy.ChooseTechnician([evSpecialist, generalist], Interim, NoLoad, preferredTechnicianId: null).ShouldBeSameAs(generalist);
    }

    [Fact]
    public void Prefers_fewest_surplus_certifications()
    {
        var evSpecialist = Tech("Aaron Evans", GeneralService, HighVoltageElectrical);
        var generalist = Tech("Zara Young", GeneralService);
        var load = new Dictionary<Guid, int> { [generalist.Id] = 5 };

        // An interim service must not take the only high-voltage technician, even when the generalist is busier.
        AllocationPolicy.ChooseTechnician([evSpecialist, generalist], Interim, load, preferredTechnicianId: null).ShouldBeSameAs(generalist);
    }

    [Fact]
    public void Technician_ties_broken_by_lower_load_then_name()
    {
        var amelia = Tech(FixedId(3), "Amelia Clarke", GeneralService);
        var ben = Tech(FixedId(2), "Ben Okafor", GeneralService);
        var chloe = Tech(FixedId(1), "Chloe Davies", GeneralService);
        Technician[] technicians = [chloe, ben, amelia];

        AllocationPolicy.ChooseTechnician(technicians, Interim, new Dictionary<Guid, int> { [amelia.Id] = 2, [ben.Id] = 1, [chloe.Id] = 0 }, null).ShouldBeSameAs(chloe);
        AllocationPolicy.ChooseTechnician(technicians, Interim, new Dictionary<Guid, int> { [amelia.Id] = 2, [ben.Id] = 1, [chloe.Id] = 1 }, null).ShouldBeSameAs(ben);
        AllocationPolicy.ChooseTechnician(technicians, Interim, new Dictionary<Guid, int> { [ben.Id] = 1, [chloe.Id] = 1 }, null).ShouldBeSameAs(amelia); // missing load = 0
        AllocationPolicy.ChooseTechnician(technicians, Interim, NoLoad, null).ShouldBeSameAs(amelia);
    }

    [Fact]
    public void Final_technician_tie_break_is_id()
    {
        var first = Tech(FixedId(1), "Sam Patel", GeneralService);
        var second = Tech(FixedId(2), "Sam Patel", GeneralService);

        AllocationPolicy.ChooseTechnician([second, first], Interim, NoLoad, null).ShouldBeSameAs(first);
        AllocationPolicy.ChooseTechnician([first, second], Interim, NoLoad, null).ShouldBeSameAs(first);
    }

    [Fact]
    public void Returns_null_when_no_technicians()
    {
        AllocationPolicy.ChooseTechnician([], Interim, NoLoad, null).ShouldBeNull();
        AllocationPolicy.ChooseTechnician([], Interim, NoLoad, Guid.NewGuid()).ShouldBeNull();
    }

    [Fact]
    public void ChooseTechnician_validates_arguments()
    {
        Technician[] technicians = [Tech("Amelia Clarke", GeneralService)];

        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseTechnician(null!, Interim, NoLoad, null)).ParamName.ShouldBe("freeCertifiedTechnicians");
        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseTechnician(technicians, null!, NoLoad, null)).ParamName.ShouldBe("serviceType");
        Should.Throw<ArgumentNullException>(() => AllocationPolicy.ChooseTechnician(technicians, Interim, null!, null)).ParamName.ShouldBe("loadToday");
        Should.Throw<ArgumentException>(() => AllocationPolicy.ChooseTechnician([null!], Interim, NoLoad, null)).ParamName.ShouldBe("freeCertifiedTechnicians");
    }
}

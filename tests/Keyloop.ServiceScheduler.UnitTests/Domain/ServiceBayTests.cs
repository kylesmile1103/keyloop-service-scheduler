using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using static Keyloop.ServiceScheduler.Domain.Resources.BayCapability;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class ServiceBayTests
{
    private static readonly Guid DealershipId = Guid.NewGuid();

    private static ServiceType Requiring(params BayCapability[] capabilities) =>
        ServiceType.Create(Guid.NewGuid(), "TEST-SERVICE", "Test Service", ServiceDuration.Create(60), capabilities, [Certification.GeneralService]);

    private static ServiceBay Bay(params BayCapability[] capabilities) =>
        ServiceBay.Create(Guid.NewGuid(), DealershipId, "Bay 1", capabilities);

    [Fact]
    public void Supports_when_capabilities_superset()
    {
        Bay(StandardLift, Diagnostics).Supports(Requiring(StandardLift)).ShouldBeTrue();
        Bay(StandardLift, Diagnostics).Supports(Requiring(Diagnostics, StandardLift)).ShouldBeTrue();
    }

    [Fact]
    public void Does_not_support_when_missing_capability()
    {
        Bay(StandardLift).Supports(Requiring(StandardLift, EvHighVoltage)).ShouldBeFalse();
        Bay(EvHighVoltage).Supports(Requiring(StandardLift)).ShouldBeFalse();
        Bay().Supports(Requiring(StandardLift)).ShouldBeFalse();
    }

    [Fact]
    public void Surplus_counts_extra_capabilities()
    {
        Bay(StandardLift, EvHighVoltage, Diagnostics).SurplusCapabilitiesFor(Requiring(StandardLift)).ShouldBe(2);
        Bay(StandardLift, EvHighVoltage).SurplusCapabilitiesFor(Requiring(EvHighVoltage)).ShouldBe(1);
        Bay(StandardLift).SurplusCapabilitiesFor(Requiring(StandardLift)).ShouldBe(0);
    }

    [Fact]
    public void Create_sets_properties_and_deduplicates_capabilities()
    {
        var id = Guid.NewGuid();

        var bay = ServiceBay.Create(id, DealershipId, "  Bay 4 - EV  ", [EvHighVoltage, StandardLift, EvHighVoltage]);

        bay.Id.ShouldBe(id);
        bay.DealershipId.ShouldBe(DealershipId);
        bay.Name.ShouldBe("Bay 4 - EV");
        bay.Capabilities.Count.ShouldBe(2);
        bay.Capabilities.SetEquals([StandardLift, EvHighVoltage]).ShouldBeTrue();
        bay.IsActive.ShouldBeTrue();
    }

    [Fact]
    public void Create_validates_arguments()
    {
        Should.Throw<ArgumentException>(() => ServiceBay.Create(Guid.Empty, DealershipId, "Bay 1", [StandardLift])).ParamName.ShouldBe("id");
        Should.Throw<ArgumentException>(() => ServiceBay.Create(Guid.NewGuid(), Guid.Empty, "Bay 1", [StandardLift])).ParamName.ShouldBe("dealershipId");
        Should.Throw<ArgumentException>(() => ServiceBay.Create(Guid.NewGuid(), DealershipId, "  ", [StandardLift])).ParamName.ShouldBe("name");
        Should.Throw<ArgumentException>(() => ServiceBay.Create(Guid.NewGuid(), DealershipId, new string('b', 101), [StandardLift])).ParamName.ShouldBe("name");
        Should.Throw<ArgumentNullException>(() => ServiceBay.Create(Guid.NewGuid(), DealershipId, "Bay 1", null!)).ParamName.ShouldBe("capabilities");
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceBay.Create(Guid.NewGuid(), DealershipId, "Bay 1", [StandardLift, (BayCapability)99]))
            .ParamName.ShouldBe("capabilities");
    }

    [Fact]
    public void Deactivate_and_activate_toggle_IsActive()
    {
        var bay = Bay(StandardLift);

        bay.Deactivate();
        bay.IsActive.ShouldBeFalse();
        bay.Supports(Requiring(StandardLift)).ShouldBeTrue();

        bay.Activate();
        bay.IsActive.ShouldBeTrue();

        ServiceBay.Create(Guid.NewGuid(), DealershipId, "Bay 9", [StandardLift], isActive: false).IsActive.ShouldBeFalse();
    }
}

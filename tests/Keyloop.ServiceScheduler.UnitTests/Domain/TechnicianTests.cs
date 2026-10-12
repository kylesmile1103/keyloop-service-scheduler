using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using static Keyloop.ServiceScheduler.Domain.Resources.Certification;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class TechnicianTests
{
    private static readonly Guid DealershipId = Guid.NewGuid();

    private static ServiceType Requiring(params Certification[] certifications) =>
        ServiceType.Create(Guid.NewGuid(), "TEST-SERVICE", "Test Service", ServiceDuration.Create(60), [BayCapability.StandardLift], certifications);

    private static Technician Tech(params Certification[] certifications) =>
        Technician.Create(Guid.NewGuid(), DealershipId, "Amelia Clarke", "T-1001", certifications);

    [Fact]
    public void Certified_when_certifications_superset()
    {
        Tech(GeneralService, Brakes).IsCertifiedFor(Requiring(GeneralService)).ShouldBeTrue();
        Tech(GeneralService, Brakes).IsCertifiedFor(Requiring(Brakes, GeneralService)).ShouldBeTrue();
    }

    [Fact]
    public void Not_certified_when_missing_certification()
    {
        Tech(GeneralService).IsCertifiedFor(Requiring(GeneralService, HighVoltageElectrical)).ShouldBeFalse();
        Tech(HighVoltageElectrical).IsCertifiedFor(Requiring(GeneralService)).ShouldBeFalse();
        Tech().IsCertifiedFor(Requiring(GeneralService)).ShouldBeFalse();
    }

    [Fact]
    public void Surplus_counts_extra_certifications()
    {
        Tech(GeneralService, Brakes, MotTester).SurplusCertificationsFor(Requiring(GeneralService)).ShouldBe(2);
        Tech(GeneralService, HighVoltageElectrical).SurplusCertificationsFor(Requiring(HighVoltageElectrical)).ShouldBe(1);
        Tech(GeneralService).SurplusCertificationsFor(Requiring(GeneralService)).ShouldBe(0);
    }

    [Fact]
    public void Create_sets_properties_and_deduplicates_certifications()
    {
        var id = Guid.NewGuid();

        var technician = Technician.Create(id, DealershipId, "  Ben Okafor ", " T-1002 ", [Diagnostics, GeneralService, Diagnostics]);

        technician.Id.ShouldBe(id);
        technician.DealershipId.ShouldBe(DealershipId);
        technician.Name.ShouldBe("Ben Okafor");
        technician.EmployeeNumber.ShouldBe("T-1002");
        technician.Certifications.Count.ShouldBe(2);
        technician.Certifications.SetEquals([GeneralService, Diagnostics]).ShouldBeTrue();
        technician.IsActive.ShouldBeTrue();
        Technician.Create(Guid.NewGuid(), DealershipId, "Off Duty", "T-1999", [GeneralService], isActive: false)
            .IsActive.ShouldBeFalse();
    }

    [Fact]
    public void Create_validates_arguments()
    {
        static Technician Create(Guid id, Guid dealershipId, string name, string employeeNumber, IEnumerable<Certification> certifications) =>
            Technician.Create(id, dealershipId, name, employeeNumber, certifications);

        Should.Throw<ArgumentException>(() => Create(Guid.Empty, DealershipId, "Amelia", "T-1", [GeneralService])).ParamName.ShouldBe("id");
        Should.Throw<ArgumentException>(() => Create(Guid.NewGuid(), Guid.Empty, "Amelia", "T-1", [GeneralService])).ParamName.ShouldBe("dealershipId");
        Should.Throw<ArgumentException>(() => Create(Guid.NewGuid(), DealershipId, " ", "T-1", [GeneralService])).ParamName.ShouldBe("name");
        Should.Throw<ArgumentException>(() => Create(Guid.NewGuid(), DealershipId, new string('a', 121), "T-1", [GeneralService])).ParamName.ShouldBe("name");
        Should.Throw<ArgumentException>(() => Create(Guid.NewGuid(), DealershipId, "Amelia", "", [GeneralService])).ParamName.ShouldBe("employeeNumber");
        Should.Throw<ArgumentException>(() => Create(Guid.NewGuid(), DealershipId, "Amelia", new string('9', 33), [GeneralService])).ParamName.ShouldBe("employeeNumber");
        Should.Throw<ArgumentNullException>(() => Create(Guid.NewGuid(), DealershipId, "Amelia", "T-1", null!)).ParamName.ShouldBe("certifications");
        Should.Throw<ArgumentOutOfRangeException>(() => Create(Guid.NewGuid(), DealershipId, "Amelia", "T-1", [(Certification)99]))
            .ParamName.ShouldBe("certifications");
    }
}

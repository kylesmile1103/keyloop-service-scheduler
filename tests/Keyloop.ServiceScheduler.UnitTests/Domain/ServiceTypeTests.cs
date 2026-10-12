using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class ServiceTypeTests
{
    private static readonly ServiceDuration Hour = ServiceDuration.Create(60);

    private static ServiceType Create(string code) =>
        ServiceType.Create(Guid.NewGuid(), code, "Test Service", Hour, [BayCapability.StandardLift], [Certification.GeneralService]);

    [Fact]
    public void Create_sets_properties_and_deduplicates_requirements()
    {
        var id = Guid.NewGuid();

        var serviceType = ServiceType.Create(
            id,
            " EV-CHARGING-FAULT ",
            "  EV Charging Fault Diagnosis ",
            ServiceDuration.Create(90),
            [BayCapability.EvHighVoltage, BayCapability.EvHighVoltage],
            [Certification.HighVoltageElectrical, Certification.Diagnostics, Certification.Diagnostics]);

        serviceType.Id.ShouldBe(id);
        serviceType.Code.ShouldBe("EV-CHARGING-FAULT");
        serviceType.Name.ShouldBe("EV Charging Fault Diagnosis");
        serviceType.Duration.ShouldBe(ServiceDuration.Create(90));
        serviceType.RequiredBayCapabilities.SetEquals([BayCapability.EvHighVoltage]).ShouldBeTrue();
        serviceType.RequiredCertifications.Count.ShouldBe(2);
        serviceType.RequiredCertifications.SetEquals([Certification.Diagnostics, Certification.HighVoltageElectrical]).ShouldBeTrue();
    }

    [Theory]
    [InlineData("EV-BATTERY-CHECK")]
    [InlineData("MOT")]
    [InlineData("A1")]
    [InlineData("DIAG-FAULT-FINDING")]
    [InlineData("ABCDEFGHIJ-KLMNOPQRST-UVWXYZ-123")] // 32 characters
    public void Create_accepts_upper_kebab_codes(string code) =>
        Create(code).Code.ShouldBe(code);

    [Theory]
    [InlineData("")]
    [InlineData("E")]
    [InlineData("ev-battery-check")]
    [InlineData("Ev-Battery-Check")]
    [InlineData("EV--CHECK")]
    [InlineData("-EV")]
    [InlineData("EV-")]
    [InlineData("EV BATTERY")]
    [InlineData("EV_BATTERY")]
    [InlineData("ABCDEFGHIJ-KLMNOPQRST-UVWXYZ-1234")] // 33 characters
    public void Create_rejects_malformed_codes(string code) =>
        Should.Throw<ArgumentException>(() => Create(code)).ParamName.ShouldBe("code");

    [Fact]
    public void Create_requires_a_capability_a_certification_and_a_duration()
    {
        var id = Guid.NewGuid();
        Should.Throw<ArgumentException>(() => ServiceType.Create(id, "MOT", "MOT Test", Hour, [], [Certification.MotTester]))
            .ParamName.ShouldBe("requiredBayCapabilities");
        Should.Throw<ArgumentException>(() => ServiceType.Create(id, "MOT", "MOT Test", Hour, [BayCapability.MotTesting], []))
            .ParamName.ShouldBe("requiredCertifications");
        Should.Throw<ArgumentException>(() => ServiceType.Create(id, "MOT", "MOT Test", default, [BayCapability.MotTesting], [Certification.MotTester]))
            .ParamName.ShouldBe("duration");
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceType.Create(id, "MOT", "MOT Test", Hour, [(BayCapability)99], [Certification.MotTester]))
            .ParamName.ShouldBe("requiredBayCapabilities");
        Should.Throw<ArgumentException>(() => ServiceType.Create(Guid.Empty, "MOT", "MOT Test", Hour, [BayCapability.MotTesting], [Certification.MotTester]))
            .ParamName.ShouldBe("id");
        Should.Throw<ArgumentException>(() => ServiceType.Create(id, "MOT", " ", Hour, [BayCapability.MotTesting], [Certification.MotTester]))
            .ParamName.ShouldBe("name");
    }
}

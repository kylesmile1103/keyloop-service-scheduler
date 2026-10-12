using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public sealed class AdminResourceEditingTests
{
    [Fact]
    public void Technician_edit_normalizes_fields_and_replaces_competences_without_changing_identity()
    {
        var id = Guid.NewGuid();
        var site = Guid.NewGuid();
        var technician = Technician.Create(id, site, "Before", "T-1", [Certification.GeneralService]);
        technician.Edit(" After ", " T-2 ", [Certification.Brakes], false, 3, new(2028, 12, 31), true, ["bmw"]);
        technician.Id.ShouldBe(id);
        technician.DealershipId.ShouldBe(site);
        technician.Name.ShouldBe("After");
        technician.EmployeeNumber.ShouldBe("T-2");
        technician.Certifications.ShouldBe([Certification.Brakes]);
        technician.IsActive.ShouldBeFalse();
        technician.HvLevel.ShouldBe(3);
        technician.HvLevelValidUntil.ShouldBe(new DateOnly(2028, 12, 31));
        technician.HvLevelConfirmed.ShouldBeTrue();
        technician.BrandSpecialisms.ShouldBe(["BMW"]);
    }

    [Fact]
    public void Invalid_technician_edit_leaves_every_field_intact()
    {
        var technician = Technician.Create(Guid.NewGuid(), Guid.NewGuid(), "Before", "T-1", [Certification.GeneralService], hvLevel: 2);
        Should.Throw<ArgumentException>(() => technician.Edit("After", "T-2", [], false, 5, null, true, []));
        technician.Name.ShouldBe("Before");
        technician.EmployeeNumber.ShouldBe("T-1");
        technician.Certifications.ShouldBe([Certification.GeneralService]);
        technician.HvLevel.ShouldBe(2);
        technician.IsActive.ShouldBeTrue();
    }

    [Fact]
    public void Confirmation_keeps_level_expiry_brands_and_activity()
    {
        var technician = Technician.Create(Guid.NewGuid(), Guid.NewGuid(), "Technician", "T-1", [], false, 3, new(2028, 12, 31), false, ["BMW"]);
        technician.ConfirmHvLevel();
        technician.HvLevelConfirmed.ShouldBeTrue();
        technician.HvLevel.ShouldBe(3);
        technician.HvLevelValidUntil.ShouldBe(new DateOnly(2028, 12, 31));
        technician.BrandSpecialisms.ShouldBe(["BMW"]);
        technician.IsActive.ShouldBeFalse();
    }

    [Fact]
    public void Bay_edit_replaces_equipment_and_preserves_identity()
    {
        var site = Guid.NewGuid();
        var id = Guid.NewGuid();
        var bay = ServiceBay.Create(id, site, "Before", [BayCapability.StandardLift]);
        bay.Edit(" After ", [BayCapability.EvHighVoltage], false);
        bay.Id.ShouldBe(id);
        bay.DealershipId.ShouldBe(site);
        bay.Name.ShouldBe("After");
        bay.Capabilities.ShouldBe([BayCapability.EvHighVoltage]);
        bay.IsActive.ShouldBeFalse();
        Should.Throw<ArgumentException>(() => bay.Edit(" ", [], true));
        bay.Name.ShouldBe("After");
        bay.Capabilities.ShouldBe([BayCapability.EvHighVoltage]);
        bay.IsActive.ShouldBeFalse();
    }

    [Theory]
    [InlineData("INTERIM-SERVICE", 0, "GeneralService")]
    [InlineData("EV-BATTERY-CHECK", 3, "")]
    public void Empty_policy_retains_service_requirements_and_legacy_HV_floor(string code, int minimum, string certifications)
    {
        var service = ReferenceDataSeed.CreateServiceTypes().Single(s => s.Code == code);
        var resolved = RequirementResolver.Resolve(service, VehicleProfile.Unknown, [], policyVersion: 3);
        resolved.PolicyVersion.ShouldBe(3);
        resolved.MinimumHvLevel.ShouldBe(minimum);
        string.Join(',', resolved.Certifications.Order()).ShouldBe(certifications);
        resolved.BayCapabilities.ShouldBe(service.RequiredBayCapabilities);
    }

    [Fact]
    public void Explicit_version_cannot_disagree_with_rule_versions()
    {
        var service = ReferenceDataSeed.CreateServiceTypes().First();
        Should.Throw<ArgumentException>(() => RequirementResolver.Resolve(service, VehicleProfile.Unknown,
            RequirementRule.DefaultPolicy(Guid.NewGuid()), policyVersion: 3));
        Should.Throw<ArgumentException>(() => RequirementResolver.Resolve(service, VehicleProfile.Unknown, [], policyVersion: 0));
    }
}

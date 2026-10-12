using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Admin;

public sealed class CompetenceWarningTests
{
    private static readonly DateOnly AppointmentDate = new(2026, 10, 13);

    [Theory]
    [InlineData("2026-10-12", true)]
    [InlineData("2026-10-13", false)]
    [InlineData("2026-10-14", false)]
    public void Hv_expiry_is_inclusive_on_appointment_local_date(string expiry, bool warning)
    {
        var site = Guid.NewGuid();
        var technician = Technician.Create(Guid.NewGuid(), site, "Technician", "T-1", [Certification.GeneralService],
            hvLevel: 2, hvLevelValidUntil: DateOnly.Parse(expiry, System.Globalization.CultureInfo.InvariantCulture), hvLevelConfirmed: false);
        var bay = ServiceBay.Create(Guid.NewGuid(), site, "Bay", [BayCapability.StandardLift]);
        var result = AppointmentCompetenceReader.Evaluate(new([BayCapability.StandardLift], [Certification.GeneralService], 2), bay, technician, AppointmentDate);
        result.RequiresReview.ShouldBe(warning);
        result.ReasonCodes.ShouldBe(warning ? ["technician-hv-expired"] : []);
    }

    [Fact]
    public void Reports_all_lapses_in_fixed_order_without_names_or_free_text()
    {
        var site = Guid.NewGuid();
        var technician = Technician.Create(Guid.NewGuid(), site, "Private Name", "T-1", [], isActive: false, hvLevel: 1);
        var bay = ServiceBay.Create(Guid.NewGuid(), site, "Private Bay", [], isActive: false);
        var result = AppointmentCompetenceReader.Evaluate(new([BayCapability.StandardLift], [Certification.GeneralService], 2), bay, technician, AppointmentDate);
        result.ReasonCodes.ShouldBe(["technician-inactive", "technician-certification-removed", "technician-hv-level-lowered", "bay-inactive", "bay-capability-removed"]);
    }
}

using Keyloop.ServiceScheduler.Api.Features.Triage;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class TriagePresentationOptionsTests
{
    [Theory]
    [InlineData(-0.01, false)]
    [InlineData(0.0, true)]
    [InlineData(0.5, true)]
    [InlineData(1.0, true)]
    [InlineData(1.01, false)]
    [InlineData(double.NaN, false)]
    [InlineData(double.PositiveInfinity, false)]
    [InlineData(double.NegativeInfinity, false)]
    public void New_thresholds_must_be_finite_unit_interval_values(double value, bool valid)
    {
        var validator = new TriageOptionsValidator();
        validator.Validate(null, new TriageOptions { RelativeCandidateFloor = value }).Succeeded.ShouldBe(valid);
        validator.Validate(null, new TriageOptions { UncoveredIssueThreshold = value }).Succeeded.ShouldBe(valid);
    }
}

using Keyloop.ServiceScheduler.Api.Domain.Catalog;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class ServiceDurationTests
{
    [Fact]
    public void Rejects_zero() =>
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceDuration.Create(0));

    [Fact]
    public void Rejects_negative() =>
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceDuration.Create(-5));

    [Fact]
    public void Rejects_non_multiple_of_five() =>
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceDuration.Create(7));

    [Fact]
    public void Rejects_over_eight_hours() =>
        Should.Throw<ArgumentOutOfRangeException>(() => ServiceDuration.Create(485));

    [Fact]
    public void Accepts_60()
    {
        var d = ServiceDuration.Create(60);
        d.Minutes.ShouldBe(60);
        d.AsTimeSpan.ShouldBe(TimeSpan.FromHours(1));
    }

    [Theory]
    [InlineData(5)]
    [InlineData(480)]
    public void Accepts_bounds(int minutes) => ServiceDuration.Create(minutes).Minutes.ShouldBe(minutes);
}

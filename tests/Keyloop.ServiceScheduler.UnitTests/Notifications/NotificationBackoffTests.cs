using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

public sealed class NotificationBackoffTests
{
    [Theory]
    [InlineData(1, 0, 10)]
    [InlineData(2, 0, 20)]
    [InlineData(3, 0, 40)]
    [InlineData(1, 0.5, 11)]
    [InlineData(1, 1, 12)]
    [InlineData(4, 1, 60)]
    [InlineData(100, 1, 60)]
    public void Exponential_delay_has_bounded_jitter_and_a_cap(int attempt, double jitter, double seconds) =>
        NotificationBackoff.Delay(attempt, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(60), jitter).TotalSeconds.ShouldBe(seconds);

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, -0.1)]
    [InlineData(1, 1.1)]
    public void Rejects_invalid_attempt_or_jitter(int attempt, double jitter) =>
        Should.Throw<ArgumentOutOfRangeException>(() => NotificationBackoff.Delay(attempt, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(60), jitter));
}

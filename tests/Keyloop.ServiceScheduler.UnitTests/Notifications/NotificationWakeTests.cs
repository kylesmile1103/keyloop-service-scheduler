using Keyloop.ServiceScheduler.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

/// <summary>
/// Verifies dispatcher sleep duration calculation between outbox polling cycles.
/// </summary>
public sealed class NotificationWakeTests
{
    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Idle = TimeSpan.FromMinutes(15);

    [Fact]
    public void Sleeps_for_the_idle_interval_when_nothing_is_pending() =>
        NotificationDispatcher.SleepFor(null, Now, Idle).ShouldBe(Idle);

    [Theory]
    [InlineData(3 * 60, 3 * 60)] // a retry due in three minutes
    [InlineData(2 * 60 * 60, 15 * 60)] // due after the idle interval: the idle wake comes first
    [InlineData(15 * 60, 15 * 60)]
    public void Sleeps_until_the_next_row_is_due_but_never_past_the_idle_interval(int dueInSeconds, int expectedSeconds) =>
        NotificationDispatcher.SleepFor(Now.AddSeconds(dueInSeconds), Now, Idle).ShouldBe(TimeSpan.FromSeconds(expectedSeconds));

    [Theory]
    [InlineData(0)] // due now, but another instance holds it (SKIP LOCKED skipped it)
    [InlineData(-600)] // overdue
    [InlineData(0.5)]
    public void Never_sleeps_less_than_a_second(double dueInSeconds) =>
        NotificationDispatcher.SleepFor(Now.AddSeconds(dueInSeconds), Now, Idle).ShouldBe(TimeSpan.FromSeconds(1));
}

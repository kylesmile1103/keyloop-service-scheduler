using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

/// <summary>
/// The host may dispose the monitor before it stops it (seen in WebApplicationFactory teardown), so stopping and disposing must work in
/// either order: an ObjectDisposedException from the second call made the 30-way concurrency test fail intermittently in teardown.
/// </summary>
public sealed class NotificationBacklogMonitorLifetimeTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static NotificationBacklogMonitor Monitor() => new(
        new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
        TimeProvider.System,
        new ConfigurationBuilder().Build());

    [Fact]
    public async Task Stopping_after_the_host_disposed_the_monitor_does_not_throw()
    {
        var monitor = Monitor();
        await monitor.StartAsync(Ct);
        monitor.Dispose();

        await Should.NotThrowAsync(() => monitor.StopAsync(Ct));
    }

    [Fact]
    public async Task Disposing_after_stopping_and_disposing_twice_do_not_throw()
    {
        var monitor = Monitor();
        await monitor.StartAsync(Ct);
        await monitor.StopAsync(Ct);

        Should.NotThrow(monitor.Dispose);
        Should.NotThrow(monitor.Dispose);
    }
}

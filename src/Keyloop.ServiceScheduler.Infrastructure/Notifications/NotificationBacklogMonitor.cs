using System.Diagnostics.Metrics;
using System.Diagnostics;
using System.Globalization;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Backs the gauges <c>scheduler.notifications.outbox_pending</c> (by kind) and <c>scheduler.notifications.oldest_pending_age</c> with
/// one query on the pending partial index, whatever <c>Notifications:Enabled</c> says: a disabled or stalled dispatcher shows as a
/// growing backlog (SYSTEM_DESIGN §12.1, G2). Collecting never waits for the database. It reports the cached result and, when that is
/// older than the metric export interval (<c>OTEL_METRIC_EXPORT_INTERVAL</c>, default 60 s), refreshes it in the background; with no
/// metric exporter nothing collects, so nothing is queried. While the latest refresh has failed the gauges report nothing (no data).
/// </summary>
public sealed class NotificationBacklogMonitor(IServiceScopeFactory scopes, TimeProvider timeProvider, IConfiguration configuration)
    : IHostedService, IDisposable
{
    // The instruments are static (InfrastructureTelemetry), the monitor belongs to a host: the running one registers itself.
    private static NotificationBacklogMonitor? s_current;

    private readonly TimeSpan _cacheFor = ExportInterval(configuration);
    private readonly CancellationTokenSource _stopping = new();
    private Backlog? _backlog;
    private long _attemptedAt;
    private int _refreshing;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Volatile.Write(ref s_current, this);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Interlocked.CompareExchange(ref s_current, null, this);
        await _stopping.CancelAsync();
    }

    public void Dispose() => _stopping.Dispose();

    internal static IEnumerable<Measurement<long>> ObservePending() => Volatile.Read(ref s_current)?.Pending() ?? [];

    internal static IEnumerable<Measurement<double>> ObserveOldestPendingAge() => Volatile.Read(ref s_current)?.OldestPendingAge() ?? [];

    /// <summary>Counts Pending rows (leased ones included) by kind and finds the oldest, in one statement.</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var rows = await db.NotificationOutbox.AsNoTracking()
            .Where(e => e.Status == NotificationStatus.Pending)
            .GroupBy(e => e.Kind)
            .Select(g => new { Kind = g.Key, Count = g.Count(), Oldest = g.Min(e => e.CreatedAt) })
            .ToListAsync(cancellationToken);
        Volatile.Write(ref _backlog, new Backlog(
            rows.ToDictionary(r => r.Kind, r => (long)r.Count), rows.Count == 0 ? null : rows.Min(r => r.Oldest)));
    }

    private IEnumerable<Measurement<long>> Pending()
    {
        RefreshIfStale();
        if (Volatile.Read(ref _backlog) is not { } backlog)
        {
            return [];
        }
        return Enum.GetValues<NotificationKind>().Select(kind => new Measurement<long>(
            backlog.PendingByKind.GetValueOrDefault(kind), new KeyValuePair<string, object?>("kind", kind.ToString())));
    }

    private IEnumerable<Measurement<double>> OldestPendingAge()
    {
        RefreshIfStale();
        if (Volatile.Read(ref _backlog) is not { } backlog)
        {
            return [];
        }
        var age = backlog.OldestCreatedAt is { } oldest ? Math.Max(0, (timeProvider.GetUtcNow().UtcDateTime - oldest).TotalSeconds) : 0;
        return [new Measurement<double>(age)];
    }

    private void RefreshIfStale()
    {
        var attemptedAt = Interlocked.Read(ref _attemptedAt);
        if ((attemptedAt != 0 && Stopwatch.GetElapsedTime(attemptedAt) < _cacheFor) || Interlocked.CompareExchange(ref _refreshing, 1, 0) != 0)
        {
            return;
        }
        Interlocked.Exchange(ref _attemptedAt, Stopwatch.GetTimestamp());
        _ = Task.Run(async () =>
        {
            try
            {
                await RefreshAsync(_stopping.Token);
            }
#pragma warning disable CA1031 // A failed refresh must not escape a metrics callback; it shows as no data until the next one succeeds.
            catch (Exception)
#pragma warning restore CA1031
            {
                Volatile.Write(ref _backlog, null);
            }
            finally
            {
                Volatile.Write(ref _refreshing, 0);
            }
        });
    }

    private static TimeSpan ExportInterval(IConfiguration configuration) =>
        int.TryParse(configuration["OTEL_METRIC_EXPORT_INTERVAL"], NumberStyles.None, CultureInfo.InvariantCulture, out var milliseconds) && milliseconds > 0
            ? TimeSpan.FromMilliseconds(milliseconds)
            : TimeSpan.FromSeconds(60);

    private sealed record Backlog(IReadOnlyDictionary<NotificationKind, long> PendingByKind, DateTime? OldestCreatedAt);
}

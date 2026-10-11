using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

/// <summary>At-least-once delivery. Claims commit before network I/O; expiring leases recover crashes and claim tokens fence stale acknowledgements.</summary>
public sealed class NotificationDispatcher(IServiceScopeFactory scopes, IEmailSender sender, IOptions<NotificationOptions> options,
    TimeProvider timeProvider, ILogger<NotificationDispatcher> logger) : BackgroundService
{
    private readonly NotificationOptions _options = options.Value;

    /// <summary>One bounded batch, also callable by deterministic tests. No network call executes inside a transaction or execution strategy.</summary>
    public async Task<int> DispatchOnceAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return 0;
        }
        var rows = await ClaimAsync(cancellationToken);
        // Start the entire batch together, so the final item never waits behind BatchSize SMTP timeouts on a ticking lease.
        await Task.WhenAll(rows.Where(e => e.Status == NotificationStatus.Pending).Select(e => DispatchAsync(e, cancellationToken)));
        foreach (var exhausted in rows.Where(e => e.Status == NotificationStatus.Failed))
        {
            SchedulerTelemetry.NotificationsFailed.Add(1, KindTag(exhausted));
            logger.NotificationFailed(exhausted.Id, exhausted.Kind.ToString(), NotificationTemplate.MaskRecipient(exhausted.Recipient), exhausted.Attempts, "LeaseExpired");
        }
        return rows.Count;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            return;
        }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await DispatchOnceAsync(stoppingToken) == _options.BatchSize)
                {
                    continue; // drain a full backlog without a poll delay
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
#pragma warning disable CA1031 // Keep the worker alive on DB/provider faults. Never log an exception containing provider PII.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                logger.NotificationDispatchCycleFailed(ex.GetType().Name);
            }
            try
            {
                await Task.Delay(_options.PollInterval, timeProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
        }
    }

    private async Task<List<NotificationOutboxEntry>> ClaimAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            var now = timeProvider.GetUtcNow().UtcDateTime;
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var rows = await db.NotificationOutbox.FromSqlInterpolated($"""
                SELECT * FROM notification_outbox
                WHERE status = 'Pending' AND next_attempt_at <= {now}
                ORDER BY next_attempt_at, id
                LIMIT {_options.BatchSize} FOR UPDATE SKIP LOCKED
                """).ToListAsync(ct);
            foreach (var row in rows)
            {
                if (row.Attempts >= _options.MaxAttempts)
                {
                    row.MarkExhausted();
                }
                else
                {
                    row.Claim(now, _options.ClaimLease);
                }
            }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return rows;
        });
    }

    private async Task DispatchAsync(NotificationOutboxEntry row, CancellationToken stoppingToken)
    {
        var started = Stopwatch.GetTimestamp();
        var tag = KindTag(row);
        SchedulerTelemetry.NotificationOutboxAge.Record(Math.Max(0, (timeProvider.GetUtcNow().UtcDateTime - row.CreatedAt).TotalSeconds), tag);
        string? failure = null;
        // Network timeout measures elapsed time; the injected business clock governs eligibility, leases and retry scheduling.
        using var timeout = new CancellationTokenSource(_options.SendTimeout);
        using var send = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, timeout.Token);
        try
        {
            await sender.SendAsync(row.ToMessage(), send.Token);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Acceptance may be in doubt. Leave the lease in place for recovery instead of falsely marking Sent or starting an immediate retry.
            return;
        }
#pragma warning disable CA1031 // All send faults are delivery failures, isolated from the booking and from other messages in the batch.
        catch (Exception)
#pragma warning restore CA1031
        {
            failure = timeout.IsCancellationRequested ? "Timeout" : "SenderError";
        }
        finally
        {
            SchedulerTelemetry.NotificationDispatchDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds, tag);
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var owned = db.NotificationOutbox.Where(e => e.Id == row.Id && e.Status == NotificationStatus.Pending && e.ClaimToken == row.ClaimToken);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        int updated;
        var masked = NotificationTemplate.MaskRecipient(row.Recipient);
        if (failure is null)
        {
            updated = await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.Status, NotificationStatus.Sent)
                .SetProperty(e => e.SentAt, now).SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, (string?)null), stoppingToken);
            if (updated == 1)
            {
                SchedulerTelemetry.NotificationsSent.Add(1, tag);
                logger.NotificationSent(row.Id, row.Kind.ToString(), masked);
            }
        }
        else if (row.Attempts >= _options.MaxAttempts)
        {
            updated = await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.Status, NotificationStatus.Failed)
                .SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, failure), stoppingToken);
            if (updated == 1)
            {
                SchedulerTelemetry.NotificationsFailed.Add(1, tag);
                logger.NotificationFailed(row.Id, row.Kind.ToString(), masked, row.Attempts, failure);
            }
        }
        else
        {
            var next = now + NotificationBackoff.Delay(row.Attempts, _options.InitialBackoff, _options.MaxBackoff, Random.Shared.NextDouble());
            updated = await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.NextAttemptAt, next)
                .SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, failure), stoppingToken);
            if (updated == 1)
            {
                SchedulerTelemetry.NotificationsRetried.Add(1, tag);
                logger.NotificationRetried(row.Id, row.Kind.ToString(), masked, row.Attempts, next, failure);
            }
        }
        if (updated == 0)
        {
            logger.NotificationClaimLost(row.Id, row.Kind.ToString());
        }
    }

    private static KeyValuePair<string, object?> KindTag(NotificationOutboxEntry row) => new("kind", row.Kind.ToString());
}

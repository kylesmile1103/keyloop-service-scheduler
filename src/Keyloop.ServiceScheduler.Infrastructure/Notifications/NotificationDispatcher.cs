using System.Diagnostics;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// At-least-once delivery (SYSTEM_DESIGN §8.9). Claims commit before network I/O; expiring leases recover crashes and claim tokens fence
/// stale acknowledgements. Rows on reserved domains are staged Suppressed and never claimed; the claim re-applies that rule to a Pending
/// row that predates it or was written outside the application. An email is rendered only here, so neither a recipient nor a template
/// problem can reach the booking or cancel that wrote the row.
/// </summary>
/// <remarks>
/// Wake strategy: drain once at start, then sleep until the first of a commit nudge (<see cref="NotificationSignal"/>), the earliest
/// Pending <c>next_attempt_at</c> (a retry or a lease expiry), or <see cref="NotificationOptions.IdleInterval"/>. An idle API therefore
/// sends no query to the database for that long, instead of one every few seconds.
/// </remarks>
public sealed class NotificationDispatcher(IServiceScopeFactory scopes, IEmailSender sender, NotificationSignal signal,
    IOptions<NotificationOptions> options, TimeProvider timeProvider, ILogger<NotificationDispatcher> logger) : BackgroundService
{
    /// <summary>
    /// The acknowledgement after a send ignores shutdown, so an accepted email is not left leased and sent again; it is bounded instead,
    /// and the lease covers it: <c>ClaimLease</c> must exceed <c>SendTimeout</c> by more than this.
    /// </summary>
    internal static readonly TimeSpan AcknowledgementTimeout = TimeSpan.FromSeconds(5);

    // When rows are due but were not claimable (another instance holds them), wait at least this long rather than spin.
    internal static readonly TimeSpan MinimumWait = TimeSpan.FromSeconds(1);

    private readonly NotificationOptions _options = options.Value;

    /// <summary>One bounded batch, also callable by deterministic tests. No network call executes inside a transaction or execution strategy.</summary>
    public async Task<int> DispatchOnceAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return 0;
        }
        var rows = await ClaimAsync(cancellationToken);
        foreach (var row in rows)
        {
            if (row.Status == NotificationStatus.Suppressed)
            {
                InfrastructureTelemetry.NotificationsSuppressed.Add(1, KindTag(row), new KeyValuePair<string, object?>("reason", row.LastFailure));
                logger.NotificationSuppressed(row.Id, row.AppointmentId, row.Kind.ToString(), row.LastFailure!);
            }
            else if (row.Status == NotificationStatus.Failed)
            {
                InfrastructureTelemetry.NotificationsFailed.Add(1, KindTag(row));
                logger.NotificationFailed(row.Id, row.AppointmentId, row.Kind.ToString(), row.Attempts, NotificationOutcomes.LeaseExpired);
            }
        }
        var claimed = rows.Where(e => e.Status == NotificationStatus.Pending).ToList();
        if (claimed.Count > 0)
        {
            var messages = await RenderAsync(claimed, cancellationToken);
            // Start the entire batch together, so the final item never waits behind BatchSize send timeouts on a ticking lease.
            await Task.WhenAll(claimed.Select(e => DispatchAsync(e, messages[e.Id], cancellationToken)));
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
            TimeSpan wait;
            try
            {
                signal.Reset();
                if (await DispatchOnceAsync(stoppingToken) == _options.BatchSize)
                {
                    continue; // drain a full backlog without waiting
                }
                wait = await UntilNextDueAsync(stoppingToken);
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
                wait = _options.InitialBackoff;
            }
            try
            {
                await signal.WaitAsync(wait, timeProvider, stoppingToken);
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
                // Staging already suppresses reserved domains (NotificationOutboxEntry.Create); this catches a row from before that rule.
                if (RecipientPolicy.IsReservedDomain(row.Recipient))
                {
                    row.Suppress(NotificationOutcomes.ReservedDomain);
                }
                else if (row.Attempts >= _options.MaxAttempts)
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

    /// <summary>
    /// Renders each claimed row from its snapshot and the dealership's and service's current names and zone (two indexed reads per
    /// batch). A row that cannot be rendered maps to null and is dead-lettered; a database fault fails the cycle and the leases recover.
    /// </summary>
    private async Task<Dictionary<Guid, EmailMessage?>> RenderAsync(List<NotificationOutboxEntry> rows, CancellationToken ct)
    {
        var snapshots = rows.ToDictionary(row => row.Id, TryReadSnapshot);
        var dealershipIds = snapshots.Values.OfType<NotificationSnapshot>().Select(s => s.DealershipId).Distinct().ToList();
        var serviceTypeIds = snapshots.Values.OfType<NotificationSnapshot>().Select(s => s.ServiceTypeId).Distinct().ToList();
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var dealerships = await db.Dealerships.AsNoTracking().Where(d => dealershipIds.Contains(d.Id))
            .Select(d => new { d.Id, d.Name, d.TimeZoneId }).ToDictionaryAsync(d => d.Id, ct);
        var services = await db.ServiceTypes.AsNoTracking().Where(s => serviceTypeIds.Contains(s.Id))
            .Select(s => new { s.Id, s.Name }).ToDictionaryAsync(s => s.Id, ct);
        return rows.ToDictionary(row => row.Id, row =>
        {
            if (snapshots[row.Id] is not { } snapshot || !dealerships.TryGetValue(snapshot.DealershipId, out var dealership)
                || !services.TryGetValue(snapshot.ServiceTypeId, out var service))
            {
                return null;
            }
            try
            {
                return NotificationTemplate.Render(row.Id, row.Kind, new NotificationDetails(snapshot.AppointmentId, row.Recipient, dealership.Name,
                    service.Name, dealership.TimeZoneId, snapshot.StartUtc, snapshot.EndUtc, snapshot.Registration, snapshot.VinLastFour));
            }
#pragma warning disable CA1031 // Any render fault (an unknown zone, a corrupt payload) fails only this row, with a fixed category.
            catch (Exception)
#pragma warning restore CA1031
            {
                return (EmailMessage?)null;
            }
        });
    }

    private static NotificationSnapshot? TryReadSnapshot(NotificationOutboxEntry row)
    {
        try
        {
            return row.ReadSnapshot();
        }
#pragma warning disable CA1031 // A corrupt payload is a render failure of this row only.
        catch (Exception)
#pragma warning restore CA1031
        {
            return null;
        }
    }

    private async Task DispatchAsync(NotificationOutboxEntry row, EmailMessage? message, CancellationToken stoppingToken)
    {
        var tag = KindTag(row);
        if (message is null)
        {
            // Deterministic: retrying cannot help, so the row is a dead letter at once and no send is attempted.
            await AcknowledgeAsync(row, NotificationStatus.Failed, NotificationOutcomes.RenderFailed);
            return;
        }
        var started = Stopwatch.GetTimestamp();
        InfrastructureTelemetry.NotificationOutboxAge.Record(Math.Max(0, (timeProvider.GetUtcNow().UtcDateTime - row.CreatedAt).TotalSeconds), tag);
        string? failure = null;
        // Network timeout measures elapsed time; the injected business clock governs eligibility, leases and retry scheduling.
        using var timeout = new CancellationTokenSource(_options.SendTimeout);
        using var send = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, timeout.Token);
        try
        {
            await sender.SendAsync(message, send.Token);
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
            failure = timeout.IsCancellationRequested ? NotificationOutcomes.Timeout : NotificationOutcomes.SenderError;
        }
        finally
        {
            InfrastructureTelemetry.NotificationDispatchDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds, tag);
        }

        if (failure is null)
        {
            await AcknowledgeAsync(row, NotificationStatus.Sent, null);
        }
        else if (row.Attempts >= _options.MaxAttempts)
        {
            await AcknowledgeAsync(row, NotificationStatus.Failed, failure);
        }
        else
        {
            await AcknowledgeAsync(row, NotificationStatus.Pending, failure);
        }
    }

    /// <summary>Records the outcome only while this claim still owns the row, with its own deadline rather than the shutdown token.</summary>
    private async Task AcknowledgeAsync(NotificationOutboxEntry row, NotificationStatus status, string? failure)
    {
        using var deadline = new CancellationTokenSource(AcknowledgementTimeout);
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var owned = db.NotificationOutbox.Where(e => e.Id == row.Id && e.Status == NotificationStatus.Pending && e.ClaimToken == row.ClaimToken);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var tag = KindTag(row);
        var kind = row.Kind.ToString();
        switch (status)
        {
            case NotificationStatus.Sent:
                if (await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.Status, NotificationStatus.Sent).SetProperty(e => e.SentAt, now)
                    .SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, (string?)null), deadline.Token) == 1)
                {
                    InfrastructureTelemetry.NotificationsSent.Add(1, tag);
                    logger.NotificationSent(row.Id, row.AppointmentId, kind);
                    return;
                }
                break;
            case NotificationStatus.Failed:
                if (await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.Status, NotificationStatus.Failed)
                    .SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, failure), deadline.Token) == 1)
                {
                    InfrastructureTelemetry.NotificationsFailed.Add(1, tag);
                    logger.NotificationFailed(row.Id, row.AppointmentId, kind, row.Attempts, failure!);
                    return;
                }
                break;
            default:
                var next = now + NotificationBackoff.Delay(row.Attempts, _options.InitialBackoff, _options.MaxBackoff, Random.Shared.NextDouble());
                if (await owned.ExecuteUpdateAsync(set => set.SetProperty(e => e.NextAttemptAt, next)
                    .SetProperty(e => e.ClaimToken, (Guid?)null).SetProperty(e => e.LastFailure, failure), deadline.Token) == 1)
                {
                    InfrastructureTelemetry.NotificationsRetried.Add(1, tag);
                    logger.NotificationRetried(row.Id, row.AppointmentId, kind, row.Attempts, next, failure!);
                    return;
                }
                break;
        }
        logger.NotificationClaimLost(row.Id, kind);
    }

    /// <summary>The earliest Pending <c>next_attempt_at</c> (one index-only read of the pending partial index) turned into a sleep.</summary>
    private async Task<TimeSpan> UntilNextDueAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var next = await db.NotificationOutbox.Where(e => e.Status == NotificationStatus.Pending).MinAsync(e => (DateTime?)e.NextAttemptAt, ct);
        return SleepFor(next, timeProvider.GetUtcNow().UtcDateTime, _options.IdleInterval);
    }

    /// <summary>
    /// How long to sleep after a cycle: until the earliest Pending row is due (a retry or a lease expiry), at least
    /// <see cref="MinimumWait"/> (a due row another instance holds must not cause a spin), at most <paramref name="idleInterval"/> (no
    /// Pending row, or one due later). A commit nudge ends the sleep early.
    /// </summary>
    internal static TimeSpan SleepFor(DateTime? nextDueUtc, DateTime nowUtc, TimeSpan idleInterval)
    {
        if (nextDueUtc is not { } next)
        {
            return idleInterval;
        }
        var until = next - nowUtc;
        return until < MinimumWait ? MinimumWait : until > idleInterval ? idleInterval : until;
    }

    private static KeyValuePair<string, object?> KindTag(NotificationOutboxEntry row) => new("kind", row.Kind.ToString());
}

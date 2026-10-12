using System.Data;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary>
/// Cancels an appointment (ARCHITECTURE §5.5, §7.3 layer 3): <c>Confirmed</c> or <c>CheckedIn</c> → <c>Cancelled</c>, with a reason. Its
/// slot is re-bookable at once, since terminal statuses are outside the exclusion constraints. No lock is taken on the normal path: the
/// row's <c>xmin</c> is the optimistic concurrency token, so a cancel that read a version another request has since changed fails with
/// <see cref="DbUpdateConcurrencyException"/> (409 <c>concurrency-conflict</c>) instead of overwriting it. An illegal transition is
/// <see cref="InvalidStateTransitionException"/> (409 <c>invalid-state-transition</c> with <c>currentStatus</c> and <c>attempted</c>),
/// an unknown id <see cref="NotFoundException"/> (404).
/// </summary>
/// <remarks>
/// <para>
/// Retries (§7.4): the transaction runs under the retrying execution strategy with commit verification, like booking. A run that reaches
/// its commit first records the row version its <c>UPDATE</c> wrote (the new <c>xmin</c>, which EF Core reads back). The strategy runs
/// again only after a failure, so from then on that commit is in doubt for the rest of the request. After each later failure the
/// verification answers "committed" when the row carries that version. Any other answer is inconclusive, because the read takes no lock
/// and may come before a commit that did happen is visible. Every later run therefore first locks the row (<c>SELECT … FOR UPDATE</c>
/// waits until the earlier run's transaction has ended), then reads it: carrying the written version, the earlier run committed and is
/// answered as such; otherwise it never committed and this run cancels afresh. The doubt belongs to the request, not to the run that
/// inherits it: a run that fails before settling it (its row lock timing out behind the earlier transaction, say) hands it to the next.
/// Comparing again after an answer is harmless, since a version found stays found (a cancelled appointment cannot change) and a version
/// proved absent never appears. A lost commit acknowledgement is therefore a 200, never a 409 for the client's own cancellation.
/// </para>
/// <para>
/// The aggregate's <c>AppointmentCancelled</c> becomes the history row inside the transaction and is logged (1010) and counted
/// (<c>scheduler.appointments.cancellations</c>) by <see cref="TelemetryDomainEventObserver"/> after the commit; a commit in doubt is
/// settled with the audit interceptor exactly as above, so each cancellation is logged and counted once (unless the strategy runs out of
/// retries before a read settles the doubt: the request is then a 500 and the history row is the only record, §7.3). The response is read
/// back after the commit (<see cref="AppointmentResponseQuery"/>), so it is what the database holds.
/// </para>
/// </remarks>
public sealed class CancelAppointmentHandler(SchedulerDbContext db, TimeProvider clock, ILogger<CancelAppointmentHandler> logger)
{
    public async Task<AppointmentResponse> HandleAsync(Guid appointmentId, string reason, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(reason);
        using var appointmentScope = logger.AppointmentScope(appointmentId);

        // Read once per request: a retried run cancels at the same instant as the run it replaces.
        var run = new CancelRun(appointmentId, reason, clock.GetUtcNow().UtcDateTime);
        await db.Database.CreateExecutionStrategy().ExecuteAsync(
            run,
            (_, state, token) => AttemptAsync(state, token),
            (_, state, token) => VerifyCommittedAsync(state, token),
            ct);

        using var dealershipScope = run.DealershipId is { } dealershipId ? logger.DealershipScope(dealershipId) : null;
        return await AppointmentResponseQuery.FindAsync(db, appointmentId, ct)
            ?? throw new NotFoundException(ProblemResources.Appointment, appointmentId);
    }

    /// <summary>One run of the cancellation; see the remarks for why every run after an in-doubt commit locks the row first.</summary>
    private async Task<bool> AttemptAsync(CancelRun run, CancellationToken ct)
    {
        // A retried run starts from nothing, except the doubt a failed commit left: the version that commit wrote, kept in the request's
        // state so that a run which fails before settling it hands it on instead of forgetting it.
        db.ChangeTracker.Clear();
        var inDoubt = run.WrittenVersion;

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (inDoubt is not null)
        {
            // The earlier run's UPDATE holds this row's lock until its transaction ends; waiting for it makes the read below conclusive.
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM appointments WHERE id = {run.AppointmentId} FOR UPDATE", ct);
        }

        var appointment = await db.Appointments.FirstOrDefaultAsync(a => a.Id == run.AppointmentId, ct)
            ?? throw new NotFoundException(ProblemResources.Appointment, run.AppointmentId);

        run.DealershipId = appointment.DealershipId;
        using var dealershipScope = logger.DealershipScope(appointment.DealershipId);

        if (inDoubt is { } written)
        {
            // Carrying the written version, the earlier run committed: answer it. Otherwise it never did: drop its events, cancel afresh.
            var committed = appointment.RowVersion == written;
            await ResolveInDoubtAsync(committed, ct);
            if (committed)
            {
                await transaction.RollbackAsync(ct);
                return true;
            }
        }

        appointment.Cancel(run.Reason, run.NowUtc);

        // UPDATE … WHERE id = @id AND xmin = <the version read above> RETURNING xmin: no row matches when another request changed it
        // since, and EF Core throws DbUpdateConcurrencyException (not transient, so never retried). The interceptor adds the history row.
        await db.SaveChangesAsync(ct);

        // From here a failure may be a lost acknowledgement of a commit that happened: VerifyCommittedAsync, or a later run, finds out.
        run.WrittenVersion = appointment.RowVersion;
        await transaction.CommitAsync(ct);
        return true;
    }

    /// <summary>
    /// Whether the cancellation committed although a run failed: the row carries the version written by the last run that reached its
    /// commit. Before any run did, nothing can have committed and the failure is simply retried. After one did, every failure is checked,
    /// including one that struck a later run before it could settle the doubt. "Committed" releases the in-doubt events; anything else
    /// settles nothing (see the remarks) and leaves it to the next run's locked read.
    /// </summary>
    private async Task<ExecutionResult<bool>> VerifyCommittedAsync(CancelRun run, CancellationToken ct)
    {
        if (run.WrittenVersion is not { } written)
        {
            return new ExecutionResult<bool>(false, false);
        }

        using var dealershipScope = run.DealershipId is { } dealershipId ? logger.DealershipScope(dealershipId) : null;
        var version = await db.Appointments.AsNoTracking().Where(a => a.Id == run.AppointmentId).Select(a => (uint?)a.RowVersion).FirstOrDefaultAsync(ct);
        if (version != written)
        {
            return new ExecutionResult<bool>(false, false);
        }

        await ResolveInDoubtAsync(committed: true, ct);
        return new ExecutionResult<bool>(true, true);
    }

    private Task ResolveInDoubtAsync(bool committed, CancellationToken ct) =>
        db.DomainEvents?.ResolveInDoubtCommitAsync(committed, ct) ?? Task.CompletedTask;

    /// <summary>The execution strategy's state across runs.</summary>
    private sealed class CancelRun(Guid appointmentId, string reason, DateTime nowUtc)
    {
        public Guid AppointmentId { get; } = appointmentId;

        public Guid? DealershipId { get; set; }

        public string Reason { get; } = reason;

        public DateTime NowUtc { get; } = nowUtc;

        /// <summary>
        /// The row version (<c>xmin</c>) written by the last run that reached its commit; null before any did. It is set just before the
        /// commit, and a later run exists only because a failure followed, so a non-null value means that commit is in doubt.
        /// </summary>
        public uint? WrittenVersion { get; set; }
    }
}

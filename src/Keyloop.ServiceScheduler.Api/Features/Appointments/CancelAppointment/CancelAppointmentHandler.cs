using System.Data;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary>
/// Cancels an appointment (SYSTEM_DESIGN §5.5, §7.3 layer 3): <c>Confirmed</c> or <c>CheckedIn</c> → <c>Cancelled</c>, with a reason. Its
/// slot is re-bookable at once, since terminal statuses are outside the exclusion constraints. No lock is taken on the normal path: the
/// row's <c>xmin</c> is the optimistic concurrency token, so a cancel that read a version another request has since changed fails with
/// <see cref="DbUpdateConcurrencyException"/> (409 <c>concurrency-conflict</c>) instead of overwriting it. An illegal transition is
/// <see cref="InvalidStateTransitionException"/> (409 <c>invalid-state-transition</c> with <c>currentStatus</c> and <c>attempted</c>),
/// an unknown id <see cref="NotFoundException"/> (404).
/// </summary>
/// <remarks>
/// <para>
/// Retries (§7.4): the transaction runs under the retrying execution strategy with commit verification, like booking. A run that reached
/// its commit remembers the row version its <c>UPDATE</c> wrote (the new <c>xmin</c>, which EF Core reads back); after a failed commit the
/// verification answers "committed" when the row carries that version. Any other answer is inconclusive, because the read takes no lock
/// and may come before a commit that did happen is visible. So the next run first locks the row (<c>SELECT … FOR UPDATE</c> waits until
/// the earlier run's transaction has ended), then reads it: carrying the written version, the earlier run committed and is answered as
/// such; otherwise it never committed and this run cancels afresh. A lost commit acknowledgement is therefore a 200, never a 409 for the
/// client's own cancellation.
/// </para>
/// <para>
/// The aggregate's <c>AppointmentCancelled</c> becomes the history row inside the transaction and is logged (1010) and counted
/// (<c>scheduler.appointments.cancellations</c>) by <see cref="TelemetryDomainEventObserver"/> after the commit; a commit in doubt is
/// settled with the audit interceptor exactly as above, so each cancellation is logged and counted once. The response is read back after
/// the commit (<see cref="AppointmentResponseQuery"/>), so it is what the database holds.
/// </para>
/// </remarks>
public sealed class CancelAppointmentHandler(SchedulerDbContext db, TimeProvider clock)
{
    public async Task<AppointmentResponse> HandleAsync(Guid appointmentId, string reason, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(reason);

        // Read once per request: a retried run cancels at the same instant as the run it replaces.
        var run = new CancelRun(appointmentId, reason, clock.GetUtcNow().UtcDateTime);
        await db.Database.CreateExecutionStrategy().ExecuteAsync(
            run,
            (_, state, token) => AttemptAsync(state, token),
            (_, state, token) => VerifyCommittedAsync(state, token),
            ct);

        return await AppointmentResponseQuery.FindAsync(db, appointmentId, ct)
            ?? throw new NotFoundException(ProblemResources.Appointment, appointmentId);
    }

    /// <summary>One run of the cancellation; see the remarks for why a run after an in-doubt commit locks the row first.</summary>
    private async Task<bool> AttemptAsync(CancelRun run, CancellationToken ct)
    {
        // A retried run starts from nothing. It is in doubt when the run before it failed at its commit and the verification could not tell.
        var inDoubt = run.Committing;
        run.Committing = false;
        db.ChangeTracker.Clear();

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (inDoubt)
        {
            // The earlier run's UPDATE holds this row's lock until its transaction ends; waiting for it makes the read below conclusive.
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM appointments WHERE id = {run.AppointmentId} FOR UPDATE", ct);
        }

        var appointment = await db.Appointments.FirstOrDefaultAsync(a => a.Id == run.AppointmentId, ct)
            ?? throw new NotFoundException(ProblemResources.Appointment, run.AppointmentId);

        if (inDoubt)
        {
            var committed = appointment.RowVersion == run.WrittenVersion;
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

        // From here a failure may be a lost acknowledgement of a commit that happened: VerifyCommittedAsync, or the next run, finds out.
        run.WrittenVersion = appointment.RowVersion;
        run.Committing = true;
        await transaction.CommitAsync(ct);
        return true;
    }

    /// <summary>
    /// Whether a run whose commit reported a failure committed anyway: the row carries the version that run wrote. Only a failure after
    /// the run reached its commit can be a lost acknowledgement; an earlier one is simply retried. "Committed" releases the in-doubt
    /// events; anything else settles nothing (see the remarks) and leaves it to the next run.
    /// </summary>
    private async Task<ExecutionResult<bool>> VerifyCommittedAsync(CancelRun run, CancellationToken ct)
    {
        if (!run.Committing)
        {
            return new ExecutionResult<bool>(false, false);
        }

        var version = await db.Appointments.AsNoTracking().Where(a => a.Id == run.AppointmentId).Select(a => (uint?)a.RowVersion).FirstOrDefaultAsync(ct);
        if (version != run.WrittenVersion)
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

        public string Reason { get; } = reason;

        public DateTime NowUtc { get; } = nowUtc;

        /// <summary>Whether the current run had reached its commit when it failed.</summary>
        public bool Committing { get; set; }

        /// <summary>The row version (<c>xmin</c>) the last run to reach its commit wrote; null before any did.</summary>
        public uint? WrittenVersion { get; set; }
    }
}

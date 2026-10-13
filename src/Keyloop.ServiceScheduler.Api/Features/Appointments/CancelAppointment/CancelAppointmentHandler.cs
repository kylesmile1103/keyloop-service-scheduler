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
/// Cancels a confirmed or checked-in appointment using optimistic concurrency and commit verification.
/// </summary>
public sealed class CancelAppointmentHandler(SchedulerDbContext db, TimeProvider clock, ILogger<CancelAppointmentHandler> logger)
{
    public async Task<AppointmentResponse> HandleAsync(Guid appointmentId, string reason, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(reason);
        using var appointmentScope = logger.AppointmentScope(appointmentId);

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

    /// <summary>Executes a single attempt of the cancellation transaction.</summary>
    private async Task<bool> AttemptAsync(CancelRun run, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var inDoubt = run.WrittenVersion;

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (inDoubt is not null)
        {
            await db.Database.ExecuteSqlAsync($"SELECT 1 FROM appointments WHERE id = {run.AppointmentId} FOR UPDATE", ct);
        }

        var appointment = await db.Appointments.FirstOrDefaultAsync(a => a.Id == run.AppointmentId, ct)
            ?? throw new NotFoundException(ProblemResources.Appointment, run.AppointmentId);

        run.DealershipId = appointment.DealershipId;
        using var dealershipScope = logger.DealershipScope(appointment.DealershipId);

        if (inDoubt is { } written)
        {
            var committed = appointment.RowVersion == written;
            await ResolveInDoubtAsync(committed, ct);
            if (committed)
            {
                await transaction.RollbackAsync(ct);
                return true;
            }
        }

        appointment.Cancel(run.Reason, run.NowUtc);

        await db.SaveChangesAsync(ct);

        run.WrittenVersion = appointment.RowVersion;
        await transaction.CommitAsync(ct);
        return true;
    }

    /// <summary>Verifies whether a failed commit attempt actually persisted the expected row version.</summary>
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

    /// <summary>Tracks execution strategy state across retry attempts.</summary>
    private sealed class CancelRun(Guid appointmentId, string reason, DateTime nowUtc)
    {
        public Guid AppointmentId { get; } = appointmentId;

        public Guid? DealershipId { get; set; }

        public string Reason { get; } = reason;

        public DateTime NowUtc { get; } = nowUtc;

        /// <summary>Row version (<c>xmin</c>) written by the last attempt that reached commit, or null.</summary>
        public uint? WrittenVersion { get; set; }
    }
}

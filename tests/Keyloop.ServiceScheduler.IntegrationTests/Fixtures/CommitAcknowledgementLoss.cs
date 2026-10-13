using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Once armed, throws a transient <see cref="NpgsqlException"/> after (or before, when <see cref="BeforeCommit"/> is set) transaction commit.</summary>
public sealed class CommitAcknowledgementLoss : DbTransactionInterceptor
{
    private int _armed;

    public int Fired { get; private set; }

    /// <summary>Faults before the commit is sent instead of after it succeeds.</summary>
    public bool BeforeCommit { get; set; }

    public void Arm() => Interlocked.Exchange(ref _armed, 1);

    public override ValueTask<InterceptionResult> TransactionCommittingAsync(
        DbTransaction transaction, TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
    {
        if (BeforeCommit)
        {
            FireIfArmed();
        }

        return ValueTask.FromResult(result);
    }

    public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        if (!BeforeCommit)
        {
            FireIfArmed();
        }

        return Task.CompletedTask;
    }

    private void FireIfArmed()
    {
        if (Interlocked.Exchange(ref _armed, 0) == 1)
        {
            Fired++;
            throw new NpgsqlException("Simulated lost commit acknowledgement", new IOException("Connection reset by peer"));
        }
    }
}

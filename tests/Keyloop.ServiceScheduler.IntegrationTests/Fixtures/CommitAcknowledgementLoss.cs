using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Simulates a lost commit acknowledgement: once armed, the next transaction commit succeeds on the server and then throws a
/// transient <see cref="NpgsqlException"/> (an <see cref="IOException"/> inside, as a dropped connection gives), so the retrying
/// execution strategy sees a failed commit that in fact committed. With <see cref="BeforeCommit"/> the fault fires before the commit
/// is sent, so the commit really fails. Register it after the host starts, then <see cref="Arm"/> it just
/// before the request under test: the migrations and test-data saves commit too.
/// </summary>
public sealed class CommitAcknowledgementLoss : DbTransactionInterceptor
{
    private int _armed;

    public int Fired { get; private set; }

    /// <summary>Fault before the commit instead (it then really fails: nothing reaches the server), for the control case.</summary>
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

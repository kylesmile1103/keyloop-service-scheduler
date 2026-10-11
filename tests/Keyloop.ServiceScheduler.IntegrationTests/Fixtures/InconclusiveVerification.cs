using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Makes the execution strategy's commit verification inconclusive, as when it reads before a commit that did happen is visible
/// (the COMMIT still in flight on the server). Once armed, the next read of the <c>appointments</c> table issued outside a transaction
/// (the next <c>times</c> reads) runs as <c>SELECT * FROM (original) WHERE FALSE</c>: the same columns, no rows. On the write paths that
/// read is the strategy's <c>verifySucceeded</c> callback: it runs after the failed transaction has ended, while every other appointment
/// read before the commit is made inside the transaction. Use it with <see cref="CommitAcknowledgementLoss"/> and assert
/// <see cref="Fired"/>, so a test cannot pass without having hidden the verification. Arm it for no more reads than verifications the
/// test expects: the response read after a write is also made outside a transaction.
/// </summary>
public sealed class InconclusiveVerification : DbCommandInterceptor
{
    private int _remaining;

    public int Fired { get; private set; }

    /// <summary>Optional: runs when the verification is hidden, before its read is sent (e.g. to take a lock the next run must wait for).</summary>
    public Func<CancellationToken, Task>? OnFired { get; set; }

    /// <summary>Hides the next <paramref name="times"/> verification reads.</summary>
    public void Arm(int times = 1) => Interlocked.Exchange(ref _remaining, times);

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.Transaction is null
            && command.CommandText.Contains("FROM appointments AS a", StringComparison.Ordinal)
            && TakeOne())
        {
            Fired++;
            if (OnFired is { } onFired)
            {
                await onFired(cancellationToken);
            }

#pragma warning disable CA2100 // The test's own wrapper around the SQL EF Core generated; no input reaches it.
            command.CommandText = $"SELECT * FROM ({command.CommandText}) AS hidden WHERE FALSE";
#pragma warning restore CA2100
        }

        return result;
    }

    private bool TakeOne()
    {
        int remaining;
        do
        {
            remaining = Volatile.Read(ref _remaining);
            if (remaining <= 0)
            {
                return false;
            }
        }
        while (Interlocked.CompareExchange(ref _remaining, remaining - 1, remaining) != remaining);

        return true;
    }
}

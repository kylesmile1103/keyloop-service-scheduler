using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Runs a test's own write between a request's read of an appointment and its <c>UPDATE</c>: once armed, the next command that updates
/// the <c>appointments</c> table waits for <paramref name="interleave"/> (e.g. another context saving a transition) before it is sent.
/// The request then writes a row version that is no longer current, which is exactly the race the <c>xmin</c> token decides.
/// </summary>
public sealed class BeforeAppointmentUpdate(Func<CancellationToken, Task> interleave) : DbCommandInterceptor
{
    private int _armed;

    public int Fired { get; private set; }

    public void Arm() => Interlocked.Exchange(ref _armed, 1);

    // EF Core sends the UPDATE with RETURNING xmin (the new token), so it executes as a reader; a non-query is covered for completeness.
    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await InterleaveAsync(command, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await InterleaveAsync(command, cancellationToken);
        return result;
    }

    private async Task InterleaveAsync(DbCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.CommandText.Contains("UPDATE appointments", StringComparison.Ordinal) && Interlocked.Exchange(ref _armed, 0) == 1)
        {
            Fired++;
            await interleave(cancellationToken);
        }
    }
}

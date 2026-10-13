using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Runs <paramref name="interleave"/> immediately before the next <c>UPDATE</c> on <paramref name="table"/> is sent.</summary>
public sealed class BeforeResourceUpdate(string table, Func<CancellationToken, Task> interleave) : DbCommandInterceptor
{
    private int _armed;

    public int Fired { get; private set; }

    public void Arm() => Interlocked.Exchange(ref _armed, 1);

    // EF Core sends the UPDATE with RETURNING xmin in the same batch as the audit insert, so it executes as a reader.
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
        if (command.CommandText.Contains("UPDATE " + table + " ", StringComparison.Ordinal) && Interlocked.Exchange(ref _armed, 0) == 1)
        {
            Fired++;
            await interleave(cancellationToken);
        }
    }
}

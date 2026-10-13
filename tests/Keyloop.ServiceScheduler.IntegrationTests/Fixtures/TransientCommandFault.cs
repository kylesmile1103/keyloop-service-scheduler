using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Once armed, fails the next command whose SQL contains <paramref name="marker"/> with a transient <see cref="NpgsqlException"/>.</summary>
public sealed class TransientCommandFault(string marker) : DbCommandInterceptor
{
    private int _armed;

    public int Fired { get; private set; }

    public void Arm() => Interlocked.Exchange(ref _armed, 1);

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        FireIfArmed(command);
        return ValueTask.FromResult(result);
    }

    // Raw SQL such as ExecuteSqlAsync runs as a non-query.
    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        FireIfArmed(command);
        return ValueTask.FromResult(result);
    }

    private void FireIfArmed(DbCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.CommandText.Contains(marker, StringComparison.Ordinal) && Interlocked.Exchange(ref _armed, 0) == 1)
        {
            Fired++;
            throw new NpgsqlException($"Simulated transient fault before a command containing '{marker}'", new IOException("Connection reset by peer"));
        }
    }
}

using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Fails every command containing <paramref name="sqlFragment"/> with a <see cref="PostgresException"/> of <paramref name="sqlState"/> and counts executions.</summary>
public sealed class SqlStateInjector(string sqlFragment, string sqlState) : DbCommandInterceptor
{
    private int _executions;

    public int Executions => Volatile.Read(ref _executions);

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.CommandText.Contains(sqlFragment, StringComparison.Ordinal))
        {
            Interlocked.Increment(ref _executions);
            throw new PostgresException("Injected by the test", "ERROR", "ERROR", sqlState);
        }

        return ValueTask.FromResult(result);
    }
}

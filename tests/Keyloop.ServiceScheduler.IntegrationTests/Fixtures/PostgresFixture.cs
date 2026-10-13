using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Npgsql;
using DotNet.Testcontainers.Images;
using Testcontainers.PostgreSql;
using Xunit.Sdk;
using Xunit.v3;

[assembly: AssemblyFixture(typeof(PostgresFixture))]

// Every test class shares the one database below and resets it with Respawn, so classes must not run concurrently.
[assembly: Parallelization(Mode = ParallelMode.None)]

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Shared PostgreSQL 17 Testcontainers fixture for the integration test assembly.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17")
        .WithImagePullPolicy(Environment.GetEnvironmentVariable("KEYLOOP_TEST_CACHED_IMAGES_ONLY") == "true"
            ? PullPolicy.Never : PullPolicy.Missing)
        .WithResourceMapping(Path.Combine(AppContext.BaseDirectory, "Fixtures/runtime-role.sql"), "/grants/")
        .WithResourceMapping(Path.Combine(AppContext.BaseDirectory, "Fixtures/verify-runtime-role.sql"), "/grants/")
        .WithDatabase("schedulerdb")
        .WithUsername("scheduler")
        .WithPassword("scheduler-test")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await _container.StartAsync();
        await WaitUntilReachableFromHostAsync(TimeSpan.FromSeconds(30));
    }

    public async ValueTask DisposeAsync() => await _container.DisposeAsync();

    /// <summary>Executes the deployment grant or verification script with <c>psql</c> in the fixture container.</summary>
    public async Task RunGrantScriptAsync(string database, bool verifyOnly, CancellationToken ct, bool succeeds = true)
    {
        var result = await _container.ExecAsync(["psql", "--no-psqlrc", "-U", "scheduler", "-d", database,
            "-v", "ON_ERROR_STOP=1", "-f", verifyOnly ? "/grants/verify-runtime-role.sql" : "/grants/runtime-role.sql"], ct);
        if (succeeds) { result.ExitCode.ShouldBe(0, result.Stderr); }
        else { result.ExitCode.ShouldNotBe(0, "the postcondition must reject excess grants"); }
    }

    private async Task WaitUntilReachableFromHostAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            try
            {
                await using var connection = new NpgsqlConnection(ConnectionString);
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand("SELECT 1", connection);
                await command.ExecuteScalarAsync();
                return;
            }
            catch (NpgsqlException) when (DateTime.UtcNow < deadline)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250));
            }
        }
    }

    /// <summary>Clears Npgsql connection pools for <paramref name="connectionStrings"/> and drops database <paramref name="name"/>.</summary>
    public async Task ReleaseDatabaseAsync(string name, params string[] connectionStrings)
    {
        foreach (var connectionString in connectionStrings)
        {
            await using var pooled = new NpgsqlConnection(connectionString);
            NpgsqlConnection.ClearPool(pooled);
        }
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        var quoted = new NpgsqlCommandBuilder().QuoteIdentifier(name);
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)", connection);
        await drop.ExecuteNonQueryAsync();
    }

    /// <summary>Creates a fresh empty database in the shared container and returns its connection string.</summary>
    public async Task<string> CreateEmptyDatabaseAsync(string name, CancellationToken ct)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(ct);
        var quoted = new NpgsqlCommandBuilder().QuoteIdentifier(name);
        await using (var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)", connection))
        {
            await drop.ExecuteNonQueryAsync(ct);
        }

        await using (var create = new NpgsqlCommand($"CREATE DATABASE {quoted}", connection))
        {
            await create.ExecuteNonQueryAsync(ct);
        }

        return new NpgsqlConnectionStringBuilder(ConnectionString) { Database = name }.ConnectionString;
    }
}

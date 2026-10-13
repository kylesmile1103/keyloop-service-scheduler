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

/// <summary>One PostgreSQL 17 container for the whole test assembly (ARCHITECTURE §14.2).</summary>
/// <remarks>
/// Docker on the author's machine is Colima. Testcontainers finds its socket through the active Docker context without any
/// configuration; if it ever cannot, run the tests with Colima's documented settings:
/// <c>DOCKER_HOST=unix://$HOME/.colima/default/docker.sock</c> and <c>TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock</c>.
/// Colima forwards a container's published port to the host a moment after the container reports ready (the first connections
/// were refused in practice), so <see cref="InitializeAsync"/> also waits until the database answers from the host side.
/// </remarks>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17")
        // Shared local Docker verification may forbid pulls; fresh CI runners retain the normal missing-image policy.
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

    /// <summary>Executes the actual deployment script with psql as owner in this fixture's disposable container.</summary>
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

    /// <summary>Creates a new, empty database in the same container (dropping any previous one of that name) and returns its connection string.</summary>
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

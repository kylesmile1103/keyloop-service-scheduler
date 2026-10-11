using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using Respawn;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// The real API host on the shared Testcontainers database, in the <c>SystemTest</c> environment, with migrations applied at
/// startup, no seeding, and the clock replaced by <paramref name="clock"/>. When <paramref name="logs"/> is given it receives every
/// log entry the host writes, from startup on (the logging configuration's level filters still apply).
/// </summary>
public sealed class SchedulerApiFactory(string connectionString, FakeTimeProvider clock, CapturingLoggerProvider? logs = null)
    : WebApplicationFactory<Program>
{
    private Respawner? _respawner;

    public FakeTimeProvider Clock { get; } = clock;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("SystemTest");
        builder.UseSetting("ConnectionStrings:schedulerdb", connectionString);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Database:SeedDemoData", "false");
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(Clock);
            if (logs is not null)
            {
                services.AddSingleton<ILoggerProvider>(logs);
            }
        });
    }

    /// <summary>Starts the host (which applies migrations) and deletes every row in <c>public</c> except the migration history.</summary>
    public async Task ResetAsync()
    {
        _ = Services;
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        _respawner ??= await Respawner.CreateAsync(connection, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = ["__EFMigrationsHistory"],
        });
        await _respawner.ResetAsync(connection);
    }

    /// <summary>Runs <paramref name="work"/> against a fresh DI scope's <see cref="SchedulerDbContext"/> (with the real interceptors).</summary>
    public async Task<T> WithDbAsync<T>(Func<SchedulerDbContext, Task<T>> work)
    {
        ArgumentNullException.ThrowIfNull(work);
        await using var scope = Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }

    /// <inheritdoc cref="WithDbAsync{T}(Func{SchedulerDbContext, Task{T}})"/>
    public async Task WithDbAsync(Func<SchedulerDbContext, Task> work)
    {
        ArgumentNullException.ThrowIfNull(work);
        await using var scope = Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }
}

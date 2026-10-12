using System.Net;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class ReadinessTests(PostgresFixture pg)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Liveness_remains_healthy_when_the_database_cannot_connect()
    {
        // A database that does not exist is unreachable, with an immediate non-transient 3D000 instead of a port timeout.
        var unavailable = new NpgsqlConnectionStringBuilder(pg.ConnectionString) { Database = "readiness_no_database" }.ConnectionString;
        await using var factory = new SchedulerApiFactory(unavailable, TestData.Clock())
            .WithWebHostBuilder(builder => builder.UseSetting("Database:MigrateOnStartup", "false"));
        using var client = factory.CreateClient();

        using var alive = await client.GetAsync("/alive", Ct);
        alive.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var notReady = await client.GetAsync("/health", Ct);
        notReady.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Readiness_is_unhealthy_when_database_migrations_are_missing(bool initialMigrationApplied)
    {
        var connectionString = await pg.CreateEmptyDatabaseAsync(initialMigrationApplied ? "readiness_pending" : "readiness_missing", Ct);
        await using var db = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>()
            .UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options);
        if (initialMigrationApplied)
        {
            await db.Database.MigrateAsync("20261011120048_InitialCreate", Ct);
        }
        await using var factory = new SchedulerApiFactory(connectionString, TestData.Clock())
            .WithWebHostBuilder(builder => builder.UseSetting("Database:MigrateOnStartup", "false"));
        using var client = factory.CreateClient();

        using var aliveBefore = await client.GetAsync("/alive", Ct);
        aliveBefore.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var notReady = await client.GetAsync("/health", Ct);
        notReady.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);

        await db.Database.MigrateAsync(Ct);

        using var ready = await client.GetAsync("/health", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var aliveAfter = await client.GetAsync("/alive", Ct);
        aliveAfter.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}

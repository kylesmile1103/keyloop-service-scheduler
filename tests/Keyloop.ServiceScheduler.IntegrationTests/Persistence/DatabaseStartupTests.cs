using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class DatabaseStartupTests(PostgresFixture pg)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    // A bare server (no database yet), and the empty database that Aspire's AddDatabase (run mode) or POSTGRES_DB (Compose) creates.
    [Theory]
    [InlineData("Development", false)]
    [InlineData("Development", true)]
    [InlineData("Demo", false)]
    [InlineData("Demo", true)]
    public async Task Startup_migrates_and_seeds_a_missing_or_empty_database(string environment, bool databaseExists)
    {
        var name = $"startup_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(pg.ConnectionString) { Database = name }.ConnectionString;
        var logs = new CapturingLoggerProvider();
        try
        {
            if (databaseExists)
            {
                await AdminAsync($"CREATE DATABASE {new NpgsqlCommandBuilder().QuoteIdentifier(name)}");
            }

            await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
                .UseEnvironment(environment)
                .UseSetting("ConnectionStrings:schedulerdb", connectionString)
                .UseSetting("Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command", "Information")
                .ConfigureServices(services => services
                    .AddSingleton<TimeProvider>(TestData.Clock())
                    .AddSingleton<ILoggerProvider>(logs)));
            using var client = factory.CreateClient();

            (await client.GetAsync("/health", Ct)).StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
            // Nothing is logged as an error, and the only failed command EF reports is the history read that MigrateAsync makes itself
            // before it creates the table: the initializer adds none, whether the database was missing or empty.
            logs.Entries.Where(e => e.Level >= LogLevel.Error).Select(e => $"{e.Category}: {e.Message}").ShouldBeEmpty();
            FailedCommands(logs).ShouldBeLessThanOrEqualTo(1, string.Join(Environment.NewLine, logs.Entries
                .Where(e => e.EventId.Id == RelationalEventId.CommandError.Id).Select(e => e.Message)));
            var failedAtStartup = FailedCommands(logs);
            (await client.GetAsync("/scalar/v1", Ct)).StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
            (await db.Database.GetPendingMigrationsAsync(Ct)).ShouldBeEmpty();
            (await db.Dealerships.OrderBy(d => d.Name).Select(d => d.Name).ToListAsync(Ct))
                .ShouldBe(["Keyloop Autohaus München", "Keyloop Motors Reading"]);
            var appointments = await db.Appointments.CountAsync(Ct);
            appointments.ShouldBeGreaterThan(0);

            // A second startup initialization must neither reapply migrations nor duplicate the demo week.
            await DatabaseInitializer.InitializeAsync(factory.Services, Ct);
            (await db.Appointments.CountAsync(Ct)).ShouldBe(appointments);
            FailedCommands(logs).ShouldBe(failedAtStartup);

            if (environment == "Demo")
            {
                var security = factory.Services.GetRequiredService<IOptions<SecurityOptions>>().Value;
                security.RateLimiting.Enabled.ShouldBeTrue();
                security.RateLimiting.BookingPermitsPerMinute.ShouldBe(30);
                security.ForwardedHeaders.Enabled.ShouldBeTrue();
                security.ForwardedHeaders.KnownProxies.ShouldBeEmpty();
                security.ForwardedHeaders.KnownNetworks.ShouldBe(["172.30.14.0/24"]);
                factory.Services.GetRequiredService<IOptions<SchedulingOptions>>().Value.MinimumLeadTime.ShouldBe(TimeSpan.FromHours(1));

                foreach (var peer in new[] { "172.30.14.10", "172.30.15.10" })
                {
                    var context = await factory.Server.SendAsync(context =>
                    {
                        context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(peer);
                        context.Request.Path = "/alive";
                        context.Request.Scheme = "http";
                        context.Request.Headers["X-Forwarded-For"] = "192.0.2.9, 203.0.113.7";
                        context.Request.Headers["X-Forwarded-Proto"] = "http, https";
                    }, Ct);
                    var trusted = peer == "172.30.14.10";
                    context.Response.StatusCode.ShouldBe(200);
                    context.Connection.RemoteIpAddress.ShouldBe(System.Net.IPAddress.Parse(trusted ? "203.0.113.7" : peer));
                    context.Request.Scheme.ShouldBe(trusted ? "https" : "http");
                    // Only the final hop is consumed, even when another forwarded address precedes it.
                    context.Request.Headers["X-Forwarded-For"].ToString().ShouldBe(trusted ? "192.0.2.9" : "192.0.2.9, 203.0.113.7");
                }
            }
        }
        finally
        {
            await AdminAsync($"DROP DATABASE IF EXISTS {new NpgsqlCommandBuilder().QuoteIdentifier(name)} WITH (FORCE)");
        }
    }

    private static int FailedCommands(CapturingLoggerProvider logs) =>
        logs.Entries.Count(e => e.EventId.Id == RelationalEventId.CommandError.Id);

    private async Task AdminAsync(string sql)
    {
        await using var admin = new NpgsqlConnection(pg.ConnectionString);
        await admin.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, admin);
        await command.ExecuteNonQueryAsync(Ct);
    }
}

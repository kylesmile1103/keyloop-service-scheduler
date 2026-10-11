using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class DatabaseStartupTests(PostgresFixture pg)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("Development")]
    [InlineData("Demo")]
    public async Task Startup_creates_a_missing_database_migrates_and_seeds_it(string environment)
    {
        var name = $"startup_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(pg.ConnectionString) { Database = name }.ConnectionString;
        try
        {
            await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
                .UseEnvironment(environment)
                .UseSetting("ConnectionStrings:schedulerdb", connectionString)
                .ConfigureServices(services => services.AddSingleton<TimeProvider>(TestData.Clock())));
            using var client = factory.CreateClient();

            (await client.GetAsync("/health", Ct)).StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
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
            await using var admin = new NpgsqlConnection(pg.ConnectionString);
            await admin.OpenAsync(Ct);
            var quoted = new NpgsqlCommandBuilder().QuoteIdentifier(name);
            await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync(Ct);
        }
    }
}

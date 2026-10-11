using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;

/// <summary>
/// Startup database work, gated per environment by <see cref="DatabaseOptions"/> (SYSTEM_DESIGN §10): migrations when
/// <c>MigrateOnStartup</c>; the reference catalogue and the demo week when <c>SeedDemoData</c>. UAT and Production set neither
/// (migration bundles; no seed data), and SystemTest migrates but leaves seeding to the tests.
/// </summary>
public static class DatabaseInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(services);
        await using var scope = services.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        var options = provider.GetRequiredService<IOptions<DatabaseOptions>>().Value;
        if (!options.MigrateOnStartup && !options.SeedDemoData)
        {
            return;
        }

        var db = provider.GetRequiredService<SchedulerDbContext>();
        var logger = provider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DatabaseInitializer).FullName!);

        if (options.MigrateOnStartup)
        {
            // EF's history repository handles both a missing database and a missing history table. A direct SQL probe here would
            // require the database to exist before MigrateAsync gets the chance to create it (Development/Demo on a bare server).
            var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
            await db.Database.MigrateAsync(ct);
            logger.MigrationsApplied(pending.Count, pending.Count == 0 ? "none" : string.Join(", ", pending));
        }

        if (options.SeedDemoData)
        {
            var clock = provider.GetRequiredService<TimeProvider>();
            logger.SeedCompleted("reference-data", await ReferenceDataSeed.EnsureSeededAsync(db, clock, ct));
            logger.SeedCompleted("demo-appointments", await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, clock, ct));
        }
    }
}

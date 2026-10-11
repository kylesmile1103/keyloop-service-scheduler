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
            // On a fresh database EF logs an error for every query against the missing history table (Migrate itself logs one);
            // checking for the table first avoids adding another to a first start's log.
            var historyExists = await db.Database
                .SqlQuery<bool>($"""SELECT to_regclass('"__EFMigrationsHistory"') IS NOT NULL AS "Value" """)
                .SingleAsync(ct);
            var pending = historyExists ? (await db.Database.GetPendingMigrationsAsync(ct)).ToList() : db.Database.GetMigrations().ToList();
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

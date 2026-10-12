using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
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
            // Npgsql reads the migration history by trying the query, so on a fresh database the read fails: on a bare server at the
            // connection (logged as an Error), in an empty database (as AddDatabase and POSTGRES_DB create it) on the missing history
            // table (Information, since Program.cs lowers CommandError). MigrateAsync makes that read once itself, so the initializer
            // does not: it creates a missing database first, as MigrateAsync would (the existence check expects the failed connection),
            // probes for the history table and takes the pending list from the model until that table exists.
            var creator = db.GetService<IRelationalDatabaseCreator>();
            var created = !await creator.ExistsAsync(ct);
            if (created)
            {
                await creator.CreateAsync(ct);
            }

            var historyExists = !created && await db.Database
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

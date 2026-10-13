using System.Data;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Runs startup database migrations and optional demo seeding under <see cref="SeedingLock"/> as configured by <see cref="DatabaseOptions"/>.
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
            // Create the database if missing and check for the migrations history table before querying pending migrations.
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
            // Instances that start together queue on the seeding lock: one seeds, and each later one then finds nothing to add instead
            // of failing its startup on a duplicate key. Both seeders are idempotent, so a retried attempt is safe.
            var (reference, appointments) = await db.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                db.ChangeTracker.Clear();
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
                await SeedingLock.AcquireAsync(db, token);
                // Startup can publish policy or create qualifying resources while another instance serves bookings.
                // Match publication/reseed order: seeding first, dealership locks before qualification reads and writes.
                var sites = await db.Dealerships.Select(d => d.Id).ToListAsync(token);
                foreach (var site in sites.Concat(new[] { ReferenceDataSeed.ReadingDealershipId, ReferenceDataSeed.MunichDealershipId }).Distinct().Order())
                {
                    await DealershipLock.AcquireAsync(db, site, token);
                }
                var reference = await ReferenceDataSeed.EnsureSeededAsync(db, clock, token);
                var appointments = await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, clock, token);
                await transaction.CommitAsync(token);
                return (reference, appointments);
            }, ct);
            // Only the committed attempt's result leaves the strategy, so a rolled-back attempt announces nothing (ReferenceSeedResult).
            reference.LogPublished(logger);
            logger.SeedCompleted("reference-data", reference.RowsAdded);
            logger.SeedCompleted("demo-appointments", appointments);
        }
    }
}

using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class MigrationTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Migrations_apply_from_empty_database()
    {
        var connectionString = await pg.CreateEmptyDatabaseAsync("migrations_from_empty", Ct);
        await using var db = new SchedulerDbContext(
            new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options);

        (await db.Database.GetAppliedMigrationsAsync(Ct)).ShouldBeEmpty();

        await db.Database.MigrateAsync(Ct);

        (await db.Database.GetPendingMigrationsAsync(Ct)).ShouldBeEmpty();
        (await db.Database.GetAppliedMigrationsAsync(Ct)).ShouldBe(db.Database.GetMigrations());
        db.Database.GetMigrations().ShouldNotBeEmpty();
    }

    [Fact]
    public async Task Exclusion_constraints_and_extension_exist()
    {
        await _factory.WithDbAsync(async db =>
        {
            var exclusions = await db.Database.SqlQuery<string>($"""
                SELECT conname::text AS "Value" FROM pg_constraint
                WHERE conrelid = 'appointments'::regclass AND contype = 'x'
                ORDER BY conname
                """).ToListAsync(Ct);
            exclusions.ShouldBe([PostgresErrorClassifier.BayConstraint, PostgresErrorClassifier.TechnicianConstraint]);

            var extensions = await db.Database.SqlQuery<string>($"""SELECT extname::text AS "Value" FROM pg_extension WHERE extname = 'btree_gist'""").ToListAsync(Ct);
            extensions.ShouldBe(["btree_gist"]);

            // The partial predicate keeps terminal statuses out of the constraint (SYSTEM_DESIGN §7.3).
            var bayDefinition = await db.Database.SqlQuery<string>($"""
                SELECT pg_get_constraintdef(oid) AS "Value" FROM pg_constraint WHERE conname = {PostgresErrorClassifier.BayConstraint}
                """).SingleAsync(Ct);
            var technicianDefinition = await db.Database.SqlQuery<string>($"""
                SELECT pg_get_constraintdef(oid) AS "Value" FROM pg_constraint WHERE conname = {PostgresErrorClassifier.TechnicianConstraint}
                """).SingleAsync(Ct);
            bayDefinition.ShouldStartWith("EXCLUDE USING gist (bay_id WITH =, time_range WITH &&) WHERE");
            technicianDefinition.ShouldStartWith("EXCLUDE USING gist (technician_id WITH =, time_range WITH &&) WHERE");
            foreach (var status in Enum.GetValues<AppointmentStatus>())
            {
                var quoted = $"'{status}'";
                if (Appointment.ActiveStatuses.Contains(status))
                {
                    bayDefinition.ShouldContain(quoted);
                    technicianDefinition.ShouldContain(quoted);
                }
                else
                {
                    bayDefinition.ShouldNotContain(quoted);
                    technicianDefinition.ShouldNotContain(quoted);
                }
            }
        });
    }

    [Fact]
    public async Task Schema_names_and_generated_columns_match_the_design()
    {
        await _factory.WithDbAsync(async db =>
        {
            var primaryKey = await db.Database.SqlQuery<string>($"""
                SELECT conname::text AS "Value" FROM pg_constraint WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'
                """).SingleAsync(Ct);
            primaryKey.ShouldBe(PostgresErrorClassifier.IdempotencyKeyConstraint);

            var checks = await db.Database.SqlQuery<string>($"""
                SELECT conname::text AS "Value" FROM pg_constraint WHERE conrelid = 'appointments'::regclass AND contype = 'c' ORDER BY conname
                """).ToListAsync(Ct);
            checks.ShouldBe(["ck_appointments_end_after_start", "ck_appointments_vin_format"]);

            var generated = await db.Database.SqlQuery<string>($"""
                SELECT column_name::text AS "Value" FROM information_schema.columns
                WHERE table_name = 'appointments' AND is_generated = 'ALWAYS'
                """).ToListAsync(Ct);
            generated.ShouldBe(["time_range"]);

            // xmin is PostgreSQL's system column; the migration must not have created a user column of that name.
            var xminColumns = await db.Database.SqlQuery<string>($"""
                SELECT column_name::text AS "Value" FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'xmin'
                """).ToListAsync(Ct);
            xminColumns.ShouldBeEmpty();

            var hoursKey = await db.Database.SqlQuery<string>($"""
                SELECT pg_get_constraintdef(oid) AS "Value" FROM pg_constraint
                WHERE conrelid = 'dealership_operating_hours'::regclass AND contype = 'p'
                """).SingleAsync(Ct);
            hoursKey.ShouldBe("PRIMARY KEY (dealership_id, day_of_week)");

            var dayIndex = await db.Database.SqlQuery<string>($"""
                SELECT indexdef AS "Value" FROM pg_indexes WHERE indexname = 'ix_appointments_dealership_id_start_utc'
                """).SingleAsync(Ct);
            dayIndex.ShouldEndWith("USING btree (dealership_id, start_utc)");
        });
    }

    [Fact]
    public async Task Generated_time_range_matches_start_end()
    {
        var (appointmentId, rangeReadBack) = await _factory.WithDbAsync(async db =>
        {
            var workshop = await TestData.WorkshopAsync(db);
            var appointment = workshop.Book(TestData.LondonTime(9));
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
            return (appointment.Id, db.Entry(appointment).Property<NpgsqlRange<DateTime>>("TimeRange").CurrentValue);
        });

        // EF reads the stored generated column back after the insert.
        rangeReadBack.LowerBound.ShouldBe(new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc));
        rangeReadBack.UpperBound.ShouldBe(new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc));
        rangeReadBack.LowerBoundIsInclusive.ShouldBeTrue();
        rangeReadBack.UpperBoundIsInclusive.ShouldBeFalse();

        var text = await _factory.WithDbAsync(async db =>
        {
            await db.Database.OpenConnectionAsync(Ct);
            await db.Database.ExecuteSqlAsync($"SET TIME ZONE 'UTC'", Ct);
            return await db.Database.SqlQuery<string>($"""SELECT time_range::text AS "Value" FROM appointments WHERE id = {appointmentId}""").SingleAsync(Ct);
        });
        text.ShouldBe("""["2026-10-13 08:00:00+00","2026-10-13 09:00:00+00")""");
    }
}

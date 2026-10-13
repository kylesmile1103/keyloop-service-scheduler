using System.Text;
using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class CustomerLookupIndexTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private Guid _dealershipId;
    private Guid _templateId;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(async db =>
        {
            var workshop = await TestData.WorkshopAsync(db);
            var template = workshop.Book(TestData.LondonTime(9));
            template.Cancel("Index proof fixture", TestData.Now);
            db.Appointments.Add(template);
            await db.SaveChangesAsync(Ct);
            _dealershipId = workshop.Dealership.Id;
            _templateId = template.Id;
        });
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Actual_lookup_plans_use_expression_indexes_on_100k_history_rows()
    {
        await _factory.WithDbAsync(async db =>
        {
            // Bulk synthetic history seeding is much heavier than the lookup. Leave the measured query's timeout unchanged.
            db.Database.SetCommandTimeout(180);
            // Exercise upgrading a sizeable pre-existing history, as a migration bundle will do in production.
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(db.Database.GetMigrations().ToList()[^2], Ct);
            // Completed/cancelled imports need no exclusive resources. Clone the real migrated row's required FK fields.
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc,
                    customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                    status, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), a.dealership_id, a.service_type_id, a.bay_id, a.technician_id,
                    a.start_utc + n * interval '1 minute', a.end_utc + n * interval '1 minute',
                    CASE WHEN n <= 10 THEN 'Alice Needleperson' ELSE 'Filler Person' END,
                    CASE WHEN n <= 10 THEN 'lookup@proof.test' ELSE 'person' || n || '@proof.test' END,
                    CASE WHEN n <= 10 THEN '+44 7700 999999' ELSE '+33 ' || lpad(n::text, 10, '0') END,
                    'WVWZZZ1KZAW' || lpad(n::text, 6, '0'),
                    CASE WHEN n <= 10 THEN 'ZX39 ' || lpad(n::text, 3, '0') ELSE 'AB' || lpad(n::text, 8, '0') END,
                    a.vehicle_make, a.vehicle_model, 'Completed', a.created_at_utc, a.updated_at_utc
                FROM appointments a CROSS JOIN generate_series(1, 100000) AS n WHERE a.id = {_templateId}
                """, Ct);
            await migrator.MigrateAsync(cancellationToken: Ct);
            await db.Database.ExecuteSqlAsync($"ANALYZE appointments", Ct);
            db.Database.SetCommandTimeout(null);
            (await db.Appointments.CountAsync(Ct)).ShouldBe(100001);
            var evidence = new StringBuilder("PostgreSQL 17, 100001 appointments, ANALYZE, default planner settings; EXPLAIN (ANALYZE, BUFFERS) of the handler SQL.\n");
            foreach (var (query, indexes) in new (string, string[])[]
            {
                ("lookup@", ["ix_appointments_lookup_email"]),
                ("ZX39", ["ix_appointments_lookup_registration"]),
                ("999999", ["ix_appointments_lookup_phone", "ix_appointments_lookup_phone_reverse"]),
                ("447700999", ["ix_appointments_lookup_phone", "ix_appointments_lookup_phone_reverse"]),
                ("needle", ["ix_appointments_lookup_name"]),
            })
            {
                var plan = await ExplainAsync(db, query);
                evidence.AppendLine($"\nQuery: {query}\n{plan}");
                foreach (var index in indexes)
                {
                    plan.ShouldContain(index, Case.Sensitive, query);
                }
                plan.ShouldContain("ix_appointments_lookup_pair", Case.Sensitive, query);
                plan.ShouldNotContain("Seq Scan on appointments", Case.Sensitive, query);
            }
            // Evidence is local, synthetic data only, reproducible by this test. The human report includes the full output.
            Directory.CreateDirectory("/tmp/kl39");
            await File.WriteAllTextAsync("/tmp/kl39/customer-lookup-explain.txt", evidence.ToString(), Ct);
        });
    }

    [Fact]
    public async Task Existing_read_only_runtime_grants_can_execute_lookup_without_ddl()
    {
        await _factory.WithDbAsync(async db =>
        {
            await db.Database.ExecuteSqlAsync($"""
                CREATE ROLE kl39_lookup_reader NOLOGIN;
                GRANT USAGE ON SCHEMA public TO kl39_lookup_reader;
                GRANT SELECT ON appointments TO kl39_lookup_reader;
                """, Ct);
            await db.Database.OpenConnectionAsync(Ct);
            try
            {
                await db.Database.ExecuteSqlAsync($"SET ROLE kl39_lookup_reader", Ct);
                var canCreate = await db.Database.SqlQuery<bool>($"""
                    SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "Value"
                    """).SingleAsync(Ct);
                canCreate.ShouldBeFalse();
                (await ExplainAsync(db, "customer")).ShouldContain("Limit");
            }
            finally
            {
                await db.Database.ExecuteSqlAsync($"RESET ROLE", Ct);
                await db.Database.CloseConnectionAsync();
                await db.Database.ExecuteSqlAsync($"DROP OWNED BY kl39_lookup_reader; DROP ROLE kl39_lookup_reader", Ct);
            }
        });
    }

    [Fact]
    public async Task Lookup_migration_rolls_back_and_reapplies_without_model_drift()
    {
        await _factory.WithDbAsync(async db =>
        {
            db.Database.HasPendingModelChanges().ShouldBeFalse();
            var migrations = db.Database.GetMigrations().ToList();
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(migrations[^2], Ct);
            var indexes = await db.Database.SqlQuery<string>($"""
                SELECT indexname::text AS "Value" FROM pg_indexes WHERE indexname LIKE 'ix_appointments_lookup_%'
                """).ToListAsync(Ct);
            indexes.ShouldBeEmpty();
            await migrator.MigrateAsync(cancellationToken: Ct);
            indexes = await db.Database.SqlQuery<string>($"""
                SELECT indexname::text AS "Value" FROM pg_indexes WHERE indexname LIKE 'ix_appointments_lookup_%'
                """).ToListAsync(Ct);
            indexes.Count.ShouldBe(6);
        });
    }

    private async Task<string> ExplainAsync(SchedulerDbContext db, string query)
    {
        var kind = CustomerLookupQuery.Kind(query);
        await db.Database.OpenConnectionAsync(Ct);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "EXPLAIN (ANALYZE, BUFFERS) " + FindReturningCustomersHandler.Sql(kind, query.Length >= 3);
            command.Parameters.Add(new NpgsqlParameter("dealership", _dealershipId));
            command.Parameters.Add(new NpgsqlParameter("query", query));
            command.Parameters.Add(new NpgsqlParameter("prefix", CustomerLookupQuery.Prefix(kind == CustomerLookupKind.Phone ? CustomerLookupQuery.Digits(query) : query)));
            command.Parameters.Add(new NpgsqlParameter("reversePrefix", CustomerLookupQuery.Prefix(string.Concat(CustomerLookupQuery.Digits(query).Reverse()))));
            await using var reader = await command.ExecuteReaderAsync(Ct);
            var plan = new StringBuilder();
            while (await reader.ReadAsync(Ct))
            {
                plan.AppendLine(reader.GetString(0));
            }
            return plan.ToString();
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}

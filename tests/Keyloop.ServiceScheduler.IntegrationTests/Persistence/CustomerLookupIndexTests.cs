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
            await migrator.MigrateAsync("20261012204715_AdminEditing", Ct);
            // Completed/cancelled imports need no exclusive resources. Clone the real migrated row's required FK fields.
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc,
                    customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                    status, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), a.dealership_id, a.service_type_id, a.bay_id, a.technician_id,
                    a.start_utc + n * interval '1 minute', a.end_utc + n * interval '1 minute',
                    CASE WHEN n <= 10 THEN 'Alice Needleperson' ELSE 'Filler Person' END,
                    CASE WHEN n <= 10 THEN 'lookup@proof.test' ELSE 'person' || n || '@proof.test' END,
                    CASE WHEN n <= 5 THEN '+44 7700 999999' WHEN n <= 10 THEN '07700 999999'
                         WHEN n <= 15 THEN '+49 151 888888' WHEN n <= 20 THEN '0151 888888'
                         ELSE '+33 ' || lpad(n::text, 10, '0') END,
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
                ("Alice Needle", ["ix_appointments_lookup_name"]),
                ("Needle Alice", ["ix_appointments_lookup_name"]),
                ("07700 999999", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("+44 7700 999999", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("0044 7700 999999", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("0151 888888", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("+49 151 888888", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("0049 151 888888", ["ix_appointments_lookup_phone_key", "ix_appointments_lookup_phone_key_reverse"]),
                ("888888", ["ix_appointments_lookup_phone_key_reverse"]),
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
            Directory.CreateDirectory("/tmp/kl39c");
            await File.WriteAllTextAsync("/tmp/kl39c/customer-lookup-explain.txt", evidence.ToString(), Ct);
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
                (await ExplainAsync(db, "07700 900001")).ShouldContain("Limit");
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
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261012204715_AdminEditing", Ct);
            var indexes = await db.Database.SqlQuery<string>($"""
                SELECT indexname::text AS "Value" FROM pg_indexes WHERE indexname LIKE 'ix_appointments_lookup_%'
                """).ToListAsync(Ct);
            indexes.ShouldBeEmpty();
            await migrator.MigrateAsync(cancellationToken: Ct);
            indexes = await db.Database.SqlQuery<string>($"""
                SELECT indexname::text AS "Value" FROM pg_indexes WHERE indexname LIKE 'ix_appointments_lookup_%'
                """).ToListAsync(Ct);
            indexes.Count.ShouldBe(9);
        });
    }

    [Theory]
    [InlineData("+44 (7700) 900-123", "7700900123")]
    [InlineData("0044 (7700) 900-123", "7700900123")]
    [InlineData("07700 900123", "7700900123")]
    [InlineData("7700900123", "7700900123")]
    [InlineData("+49 (151) 2345-6789", "15123456789")]
    [InlineData("0049 (151) 2345-6789", "15123456789")]
    [InlineData("0151 23456789", "15123456789")]
    [InlineData("15123456789", "15123456789")]
    [InlineData("+33 (123) 456-789", "33123456789")]
    [InlineData("0033 (123) 456-789", "0033123456789")]
    [InlineData("447700900123", "447700900123")]
    [InlineData("00123456789", "00123456789")]
    [InlineData("00151 23456789", "0015123456789")]
    public async Task Phone_key_normalizes_supported_prefixes_without_guessing_other_country_codes(string value, string expected)
    {
        await _factory.WithDbAsync(async db =>
        {
            var key = await db.Database.SqlQuery<string>($"""
                SELECT public.customer_lookup_phone_key({value}) AS "Value"
                """).SingleAsync(Ct);
            key.ShouldBe(expected);
        });
    }

    [Fact]
    public async Task Phone_migration_is_additive_and_previous_api_sql_works_after_upgrade_and_rollback()
    {
        await _factory.WithDbAsync(async db =>
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261013073749_CustomerLookupIndexes", Ct);
            var previousDefinitions = await LookupIndexDefinitionsAsync(db);
            previousDefinitions.Count.ShouldBe(6);
            var previousNames = await db.Database.SqlQuery<string>($"""
                SELECT pg_get_functiondef('public.customer_lookup_name_prefixes(text)'::regprocedure) AS "Value"
                """).SingleAsync(Ct);
            await AssertPreviousPhoneQueryAsync(db);
            await migrator.MigrateAsync("20261013091600_CustomerLookupPhoneNormalization", Ct);
            var upgradedDefinitions = await LookupIndexDefinitionsAsync(db);
            upgradedDefinitions.Count.ShouldBe(8);
            foreach (var definition in previousDefinitions)
            {
                upgradedDefinitions.ShouldContain(definition);
            }
            (await db.Database.SqlQuery<string>($"""
                SELECT pg_get_functiondef('public.customer_lookup_name_prefixes(text)'::regprocedure) AS "Value"
                """).SingleAsync(Ct)).ShouldBe(previousNames);
            await AssertPreviousPhoneQueryAsync(db);
            await migrator.MigrateAsync("20261013073749_CustomerLookupIndexes", Ct);
            (await LookupIndexDefinitionsAsync(db)).ShouldBe(previousDefinitions);
            await AssertPreviousPhoneQueryAsync(db);
            await migrator.MigrateAsync(cancellationToken: Ct);
        });
    }

    private static async Task<List<string>> LookupIndexDefinitionsAsync(SchedulerDbContext db) =>
        await db.Database.SqlQuery<string>($"""
            SELECT indexdef AS "Value" FROM pg_indexes WHERE indexname LIKE 'ix_appointments_lookup_%' ORDER BY indexname
            """).ToListAsync(Ct);

    private async Task AssertPreviousPhoneQueryAsync(SchedulerDbContext db)
    {
        // Task 39A's two phone candidate branches, unchanged. Both must work without the new function or indexes.
        var phones = await db.Database.SqlQuery<string>($"""
            SELECT customer_phone AS "Value" FROM appointments
            WHERE dealership_id = {_dealershipId} AND regexp_replace(customer_phone, '[^0-9]', '', 'g') LIKE {"447700%"}
            UNION
            SELECT customer_phone AS "Value" FROM appointments
            WHERE dealership_id = {_dealershipId} AND reverse(regexp_replace(customer_phone, '[^0-9]', '', 'g')) LIKE {"100009%"}
            """).ToListAsync(Ct);
        phones.ShouldBe(["+44 7700 900001"]);
    }

    private async Task<string> ExplainAsync(SchedulerDbContext db, string query)
    {
        var kind = CustomerLookupQuery.Kind(query);
        await db.Database.OpenConnectionAsync(Ct);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            var words = CustomerLookupQuery.NameWords(query);
            command.CommandText = "EXPLAIN (ANALYZE, BUFFERS) " + FindReturningCustomersHandler.Sql(kind, words.Length > 0);
            command.Parameters.Add(new NpgsqlParameter("dealership", _dealershipId));
            command.Parameters.Add(new NpgsqlParameter("query", query));
            command.Parameters.Add(new NpgsqlParameter("nameWords", words));
            command.Parameters.Add(new NpgsqlParameter("prefix", CustomerLookupQuery.Prefix(kind == CustomerLookupKind.Phone
                ? CustomerLookupQuery.Digits(query) : kind == CustomerLookupKind.Email ? query : string.Concat(query.Where(c => !char.IsWhiteSpace(c))))));
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

using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class CustomerLookupScopedNameTests(PostgresFixture pg) : IAsyncLifetime
{
    private const string PreviousMigration = "20261013091600_CustomerLookupPhoneNormalization";
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
            template.Cancel("Scoped name fixture", TestData.Now);
            db.Appointments.Add(template);
            await db.SaveChangesAsync(Ct);
            _dealershipId = workshop.Dealership.Id;
            _templateId = template.Id;
        });
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Name_keys_qualify_every_literal_prefix_with_the_dealership()
    {
        await _factory.WithDbAsync(async db =>
        {
            var keys = await db.Database.SqlQuery<string>($"""
                SELECT unnest(public.customer_lookup_scoped_name_prefixes({_dealershipId}, {"  Grace\tO'Neill  "})) AS "Value"
                """).ToListAsync(Ct);
            keys.ShouldBe(new[] { "gra", "grac", "grace", "o'n", "o'ne", "o'nei", "o'neil", "o'neill" }
                .Select(prefix => $"{_dealershipId}:{prefix}"));
            var other = Guid.NewGuid();
            (await db.Database.SqlQuery<string>($"""
                SELECT unnest(public.customer_lookup_scoped_name_prefixes({other}, {"Grace O'Neill"})) AS "Value"
                """).ToListAsync(Ct)).ShouldAllBe(key => key.StartsWith(other.ToString(), StringComparison.Ordinal));
            (await db.Database.SqlQuery<string>($"""
                SELECT unnest(public.customer_lookup_scoped_name_prefixes({_dealershipId}, {"Al Bo"})) AS "Value"
                """).ToListAsync(Ct)).ShouldBeEmpty();
            (await db.Database.SqlQuery<string>($"""
                SELECT provolatile::text || ':' || proisstrict::text || ':' || proparallel::text || ':' || prosecdef::text
                    || ':' || array_to_string(proconfig, ',') AS "Value"
                FROM pg_proc WHERE oid = 'public.customer_lookup_scoped_name_prefixes(uuid,text)'::regprocedure
                """).SingleAsync(Ct)).ShouldBe("i:true:s:false:search_path=pg_catalog");
        });
    }

    [Theory]
    [InlineData("smi")]
    [InlineData("alice smi")]
    [InlineData("SMI ALICE")]
    public async Task Other_dealership_matching_names_never_identify_a_local_pair(string query)
    {
        var other = TestData.NewDealership("Other name matches");
        await _factory.WithDbAsync(async db =>
        {
            db.Dealerships.Add(other);
            await db.SaveChangesAsync(Ct);
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc,
                    customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                    status, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), {other.Id}, service_type_id, bay_id, technician_id, start_utc + interval '1 day',
                    end_utc + interval '1 day', 'Alice Smith', customer_email, customer_phone, vehicle_vin,
                    vehicle_registration, vehicle_make, vehicle_model, 'Cancelled', created_at_utc, updated_at_utc
                FROM appointments WHERE id = {_templateId}
                """, Ct);
        });
        (await FindAsync(_dealershipId, query)).ShouldBeEmpty();
        var found = (await FindAsync(other.Id, query)).ShouldHaveSingleItem();
        found.Customer.Name.ShouldBe("Alice Smith");
        found.Visits.ShouldBe(1);
    }

    [Fact]
    public async Task Scoped_name_migration_preserves_previous_sql_and_objects_through_upgrade_and_rollback()
    {
        await _factory.WithDbAsync(async db =>
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(PreviousMigration, Ct);
            var definitions = await OldDefinitionsAsync(db);
            definitions.Count.ShouldBe(9);
            var extensions = await db.Database.SqlQuery<string>($"SELECT extname::text AS \"Value\" FROM pg_extension ORDER BY extname").ToListAsync(Ct);
            var previous = await PreviousNamesAsync(db);
            previous.ShouldBe(["Customer 1"]);
            await migrator.MigrateAsync(cancellationToken: Ct);
            (await OldDefinitionsAsync(db)).ShouldBe(definitions);
            (await PreviousNamesAsync(db)).ShouldBe(previous);
            (await db.Database.SqlQuery<string>($"SELECT extname::text AS \"Value\" FROM pg_extension ORDER BY extname").ToListAsync(Ct)).ShouldBe(extensions);
            db.Database.HasPendingModelChanges().ShouldBeFalse();
            await migrator.MigrateAsync(PreviousMigration, Ct);
            (await OldDefinitionsAsync(db)).ShouldBe(definitions);
            (await PreviousNamesAsync(db)).ShouldBe(previous);
            (await db.Database.SqlQuery<bool>($"""
                SELECT to_regprocedure('public.customer_lookup_scoped_name_prefixes(uuid,text)') IS NULL
                    AND to_regclass('public.ix_appointments_lookup_name_scoped') IS NULL AS "Value"
                """).SingleAsync(Ct)).ShouldBeTrue();
            await migrator.MigrateAsync(cancellationToken: Ct);
        });
    }

    [Fact]
    public async Task Common_name_prefix_reads_only_dealership_postings_on_100k_rows_across_50_dealerships()
    {
        await _factory.WithDbAsync(async db =>
        {
            db.Database.SetCommandTimeout(180);
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync(PreviousMigration, Ct);
            db.Dealerships.AddRange(Enumerable.Range(1, 49).Select(n => TestData.NewDealership($"Fleet proof {n}")));
            await db.SaveChangesAsync(Ct);
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc,
                    customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                    status, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), d.id, a.service_type_id, a.bay_id, a.technician_id,
                    a.start_utc + n * interval '1 minute', a.end_utc + n * interval '1 minute',
                    CASE WHEN n <= 200 THEN 'Alice Smith' ELSE 'Filler Person' END,
                    'person' || n || '@proof.test', a.customer_phone, 'WVWZZZ1KZAW' || lpad(n::text, 6, '0'),
                    'AB' || lpad(n::text, 8, '0'), a.vehicle_make, a.vehicle_model, 'Completed', a.created_at_utc, a.updated_at_utc
                FROM appointments a CROSS JOIN dealerships d CROSS JOIN generate_series(1, 2000) AS n WHERE a.id = {_templateId}
                """, Ct);
            await db.Database.ExecuteSqlAsync($"VACUUM ANALYZE appointments", Ct);
            (await db.Appointments.CountAsync(Ct)).ShouldBe(100001);
            (await db.Appointments.Select(a => a.DealershipId).Distinct().CountAsync(Ct)).ShouldBe(50);
            var before = await ExplainAsync(db, previous: true);
            var beforeJson = await ExplainAsync(db, previous: true, json: true);
            await migrator.MigrateAsync(cancellationToken: Ct);
            await db.Database.ExecuteSqlAsync($"VACUUM ANALYZE appointments", Ct);
            db.Database.SetCommandTimeout(null);
            var after = await ExplainAsync(db, previous: false);
            var afterJson = await ExplainAsync(db, previous: false, json: true);
            before.ShouldContain("ix_appointments_lookup_name");
            after.ShouldContain("ix_appointments_lookup_name_scoped");
            after.ShouldNotContain("Seq Scan on appointments");
            using var oldPlan = JsonDocument.Parse(beforeJson);
            using var newPlan = JsonDocument.Parse(afterJson);
            IndexNode(oldPlan.RootElement[0].GetProperty("Plan"), "ix_appointments_lookup_name").GetProperty("Actual Rows").GetInt32().ShouldBe(10000);
            IndexNode(newPlan.RootElement[0].GetProperty("Plan"), "ix_appointments_lookup_name_scoped").GetProperty("Actual Rows").GetInt32().ShouldBe(200);
            var evidence = $"PostgreSQL 17; 100001 appointments across 50 dealerships; 10000 Alice Smith rows, 200 at target; query smi.\n"
                + $"Default planner settings; VACUUM ANALYZE before each measurement. Full handler SQL, old name branch then new.\n\nBEFORE\n{before}\nAFTER\n{after}\nBEFORE JSON\n{beforeJson}\nAFTER JSON\n{afterJson}";
            Directory.CreateDirectory("/tmp/kl41");
            await File.WriteAllTextAsync("/tmp/kl41/customer-lookup-scoped-name-explain.txt", evidence, Ct);
            var found = await FindAsync(_dealershipId, "smi");
            found.Count.ShouldBe(8);
            found.ShouldAllBe(row => row.Customer.Name == "Alice Smith" && row.Visits == 1);
        });
    }

    private static JsonElement IndexNode(JsonElement node, string index)
    {
        if (node.TryGetProperty("Index Name", out var name) && name.GetString() == index)
        {
            return node;
        }
        if (node.TryGetProperty("Plans", out var plans))
        {
            foreach (var child in plans.EnumerateArray())
            {
                var found = IndexNode(child, index);
                if (found.ValueKind != JsonValueKind.Undefined)
                {
                    return found;
                }
            }
        }
        return default;
    }

    private async Task<string> ExplainAsync(SchedulerDbContext db, bool previous, bool json = false)
    {
        var sql = FindReturningCustomersHandler.Sql(CustomerLookupKind.RegistrationOrName);
        if (previous)
        {
            sql = sql.Replace("public.customer_lookup_scoped_name_prefixes(dealership_id, customer_name)", "public.customer_lookup_name_prefixes(customer_name)", StringComparison.Ordinal)
                .Replace("@dealership::text || ':' || lower(word)", "lower(word)", StringComparison.Ordinal);
        }
        await db.Database.OpenConnectionAsync(Ct);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = $"EXPLAIN (ANALYZE, BUFFERS{(json ? ", FORMAT JSON" : "")}) " + sql;
            command.Parameters.Add(new NpgsqlParameter("dealership", _dealershipId));
            command.Parameters.Add(new NpgsqlParameter("prefix", "smi%"));
            command.Parameters.Add(new NpgsqlParameter("nameWords", new[] { "smi" }));
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

    private static async Task<List<string>> OldDefinitionsAsync(SchedulerDbContext db) => await db.Database.SqlQuery<string>($"""
        SELECT indexdef AS "Value" FROM pg_indexes
        WHERE indexname LIKE 'ix_appointments_lookup_%' AND indexname <> 'ix_appointments_lookup_name_scoped'
        UNION ALL
        SELECT pg_get_functiondef('public.customer_lookup_name_prefixes(text)'::regprocedure)
        ORDER BY "Value"
        """).ToListAsync(Ct);

    private async Task<List<string>> PreviousNamesAsync(SchedulerDbContext db) => await db.Database.SqlQuery<string>($"""
        SELECT customer_name AS "Value" FROM appointments WHERE dealership_id = {_dealershipId}
            AND public.customer_lookup_name_prefixes(customer_name) @> ARRAY['cus']::text[]
        """).ToListAsync(Ct);

    private async Task<IReadOnlyList<ReturningCustomerResponse>> FindAsync(Guid dealership, string query)
    {
        using var client = _factory.CreateClient();
        using var response = await client.PostJsonAsync($"/api/v1/dealerships/{dealership}/customer-lookups",
            new FindReturningCustomersRequest(query), SchedulerJsonContext.Default.FindReturningCustomersRequest, Ct);
        response.StatusCode.ShouldBe(System.Net.HttpStatusCode.OK);
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListReturningCustomerResponse, Ct);
    }
}

using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class DealershipLockTests(PostgresFixture pg)
{
    private const long PinnedKey = 5191227312569305338;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void Key_is_a_stable_function_of_the_dealership_id()
    {
        var id = Guid.Parse("0f8fad5b-d9cb-469f-a165-70867728950e");

        var bytes = id.ToByteArray();
        DealershipLock.KeyFor(id).ShouldBe(BitConverter.ToInt64(bytes, 0) ^ BitConverter.ToInt64(bytes, 8));
        DealershipLock.KeyFor(id).ShouldBe(DealershipLock.KeyFor(Guid.Parse(id.ToString())));
        DealershipLock.KeyFor(id).ShouldNotBe(DealershipLock.KeyFor(Guid.NewGuid()));
    }

    [Fact]
    public void Key_of_a_seeded_dealership_is_pinned_because_a_change_breaks_rolling_deployments()
    {
        // Old and new instances must lock the same key for one dealership. If this value changes, deploy with a full stop and start.
        DealershipLock.KeyFor(Guid.Parse("0f8fad5b-d9cb-469f-a165-70867728950e")).ShouldBe(PinnedKey);
    }

    [Fact]
    public void Time_ordered_ids_from_the_same_millisecond_get_distinct_keys()
    {
        var timestamp = new DateTimeOffset(2026, 10, 13, 9, 0, 0, TimeSpan.Zero);
        var ids = Enumerable.Range(0, 20_000).Select(_ => Guid.CreateVersion7(timestamp)).ToArray();

        ids.Select(id => BitConverter.ToInt64(id.ToByteArray(), 0)).Distinct().Count().ShouldBeLessThanOrEqualTo(4096);
        ids.Select(DealershipLock.KeyFor).Distinct().Count().ShouldBe(ids.Length);
    }

    [Fact]
    public void Ids_that_differ_only_in_their_second_half_get_distinct_keys()
    {
        var first = new byte[16];
        var second = new byte[16];
        Array.Fill(first, (byte)0x5A);
        Array.Fill(second, (byte)0x5A);
        second[15] = 0x5B;

        DealershipLock.KeyFor(new Guid(first)).ShouldNotBe(DealershipLock.KeyFor(new Guid(second)));
    }

    [Fact]
    public async Task Lock_is_held_until_the_transaction_ends()
    {
        var dealershipId = Guid.NewGuid();
        var key = DealershipLock.KeyFor(dealershipId);
        await using var holder = NewContext();
        await using var other = new NpgsqlConnection(pg.ConnectionString);
        await other.OpenAsync(Ct);

        await using (var transaction = await holder.Database.BeginTransactionAsync(Ct))
        {
            await DealershipLock.AcquireAsync(holder, dealershipId, Ct);

            (await TryLockAsync(other, key)).ShouldBeFalse("another session must wait while the booking transaction holds the key");
            (await TryLockAsync(other, DealershipLock.KeyFor(Guid.NewGuid()))).ShouldBeTrue("other dealerships are unaffected");

            await transaction.CommitAsync(Ct);
        }

        (await TryLockAsync(other, key)).ShouldBeTrue("the transaction-scoped lock is released at commit");
    }

    [Fact]
    public async Task Acquiring_outside_a_transaction_is_a_programming_error()
    {
        await using var db = NewContext();

        // Without a transaction, pg_advisory_xact_lock would be released as soon as its own statement finished.
        await Should.ThrowAsync<InvalidOperationException>(() => DealershipLock.AcquireAsync(db, Guid.NewGuid(), Ct));
    }

    private SchedulerDbContext NewContext() =>
        new(new DbContextOptionsBuilder<SchedulerDbContext>().UseNpgsql(pg.ConnectionString).UseSnakeCaseNamingConvention().Options);

    private static async Task<bool> TryLockAsync(NpgsqlConnection connection, long key)
    {
        // Each autocommit statement is its own transaction, so a successful try-lock here is released immediately.
        await using var command = new NpgsqlCommand("SELECT pg_try_advisory_xact_lock(@key)", connection);
        command.Parameters.AddWithValue("key", key);
        return (bool)(await command.ExecuteScalarAsync(Ct))!;
    }
}

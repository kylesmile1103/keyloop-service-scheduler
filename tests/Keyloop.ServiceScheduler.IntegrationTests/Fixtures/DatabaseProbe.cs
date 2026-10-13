using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Observes the database from outside the API, for tests that must know where concurrent requests are waiting.</summary>
public static class DatabaseProbe
{
    /// <summary>Waits until at least <paramref name="count"/> other database sessions are blocked on a lock.</summary>
    public static async Task WaitForBlockedSessionsAsync(string connectionString, int count, CancellationToken ct)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var query = new NpgsqlCommand(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
            connection);
        var deadline = DateTime.UtcNow.AddSeconds(15);
        long blocked;
        while ((blocked = (long)(await query.ExecuteScalarAsync(ct))!) < count)
        {
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException($"Expected {count} sessions waiting on a lock; {blocked} are.");
            }

            await Task.Delay(TimeSpan.FromMilliseconds(20), ct);
        }
    }
}

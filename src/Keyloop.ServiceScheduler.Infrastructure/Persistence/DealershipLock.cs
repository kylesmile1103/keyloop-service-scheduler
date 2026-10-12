using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// The per-dealership booking lock (ARCHITECTURE §7.3 layer 2, ADR-003): a transaction-scoped PostgreSQL advisory lock that
/// serialises check-then-insert for one dealership and is released at commit or rollback.
/// </summary>
public static class DealershipLock
{
    /// <summary>A stable 64-bit key: the first eight bytes of the id.</summary>
    public static long KeyFor(Guid dealershipId) => BitConverter.ToInt64(dealershipId.ToByteArray(), 0);

    /// <summary>Waits for and takes the dealership's lock inside the current transaction.</summary>
    /// <exception cref="InvalidOperationException">No transaction is open, so the lock would be released immediately.</exception>
    public static Task AcquireAsync(DbContext db, Guid dealershipId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "The dealership lock is transaction-scoped; begin a transaction (at READ COMMITTED) before acquiring it.");
        }

        // Interpolated, so the key is sent as a parameter.
        return db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({KeyFor(dealershipId)})", ct);
    }
}

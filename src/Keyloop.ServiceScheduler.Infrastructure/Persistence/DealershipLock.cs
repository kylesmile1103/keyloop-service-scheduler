using System.Buffers.Binary;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// The per-dealership booking lock (ARCHITECTURE §7.3 layer 2, ADR-003): a transaction-scoped PostgreSQL advisory lock that
/// serialises check-then-insert for one dealership and is released at commit or rollback.
/// </summary>
public static class DealershipLock
{
    /// <summary>
    /// A stable 64-bit key from all 128 bits of the id: its two halves XOR-folded. Taking only the first eight bytes would leave
    /// time-ordered ids (UUIDv7, the codebase's convention for new ids) created in the same millisecond with 12 distinguishing bits,
    /// so unrelated dealerships could share a key and wait on each other. Changing this derivation breaks a rolling deployment
    /// (old and new instances would lock different keys for one dealership); change it only with a full stop and start.
    /// </summary>
    public static long KeyFor(Guid dealershipId)
    {
        Span<byte> bytes = stackalloc byte[16];
        dealershipId.TryWriteBytes(bytes);
        return BinaryPrimitives.ReadInt64LittleEndian(bytes) ^ BinaryPrimitives.ReadInt64LittleEndian(bytes[8..]);
    }

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

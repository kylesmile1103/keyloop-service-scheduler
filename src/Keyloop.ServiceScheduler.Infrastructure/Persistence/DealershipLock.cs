using System.Buffers.Binary;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Transaction-scoped PostgreSQL advisory lock that serialises check-then-insert operations for a dealership.
/// </summary>
public static class DealershipLock
{
    /// <summary>
    /// Derives a stable 64-bit advisory lock key by XOR-folding all 128 bits of <paramref name="dealershipId"/>.
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

using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Serialises reference and demo seeding across API instances (startup seeding and the demo reseed): a transaction-scoped PostgreSQL
/// advisory lock on a fixed pair of 32-bit keys. PostgreSQL keeps the two-key and single 64-bit key spaces apart, so it never collides
/// with a <see cref="DealershipLock"/>, and no booking transaction takes it (ADR-003).
/// </summary>
public static class SeedingLock
{
    /// <summary>The first key: this application's advisory-lock namespace ("KLSS").</summary>
    public const int Namespace = 0x4B4C5353;

    /// <summary>The second key: reference and demo seeding.</summary>
    public const int Seeding = 1;

    /// <summary>Waits for and takes the seeding lock inside the current transaction.</summary>
    /// <exception cref="InvalidOperationException">No transaction is open, so the lock would be released immediately.</exception>
    public static Task AcquireAsync(DbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("The seeding lock is transaction-scoped; begin a transaction before acquiring it.");
        }

        // Interpolated, so the keys are sent as parameters.
        return db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({Namespace}, {Seeding})", ct);
    }
}

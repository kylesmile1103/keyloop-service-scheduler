using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Transaction-scoped two-key PostgreSQL advisory lock that serialises reference and demo seeding across API instances.
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

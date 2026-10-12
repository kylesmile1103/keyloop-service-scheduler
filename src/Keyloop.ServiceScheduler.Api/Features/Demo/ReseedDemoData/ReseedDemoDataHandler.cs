using System.Data;
using System.Security.Cryptography;
using System.Text;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

/// <summary>
/// Puts the demo back to its starting point (Addendum C §C3): deletes every appointment of the demo dealerships, in any status, with its
/// history rows and the idempotency keys that would replay it, restores the seeded competence of seeded technicians whose HV level
/// nobody confirmed (<see cref="ReferenceDataSeed.RestoreSeededCompetenceAsync"/>), then books the deterministic demo week again
/// (<see cref="DemoAppointmentSeeder"/>, after <see cref="ReferenceDataSeed"/> in case the catalogue is gone), all in one transaction.
/// </summary>
/// <remarks>
/// <para>
/// The transaction runs at <c>READ COMMITTED</c> and first takes both demo dealerships' locks (<see cref="DealershipLock"/>), in a fixed
/// order: a booking in flight finishes before anything is deleted, and a booking that arrives meanwhile waits and then sees the new
/// week. This cannot deadlock with bookings, which hold one dealership's lock and never wait for another (ADR-003), nor with another
/// reseed, which takes the locks in the same order.
/// </para>
/// <para>
/// It runs under the retrying execution strategy without commit verification: the demo week's ids are deterministic, so a run repeated
/// after a commit whose acknowledgement was lost deletes what that commit booked and books the same rows again.
/// </para>
/// </remarks>
public sealed class ReseedDemoDataHandler(SchedulerDbContext db, TimeProvider clock, IOptions<DemoOptions> options, ILogger<ReseedDemoDataHandler> logger)
{
    /// <summary>The seeded dealerships, in the order their locks are taken.</summary>
    private static readonly Guid[] DemoDealerships = [ReferenceDataSeed.ReadingDealershipId, ReferenceDataSeed.MunichDealershipId];

    /// <returns>What was deleted and created, or null when <paramref name="presentedKey"/> is missing or wrong (then nothing is done).</returns>
    public async Task<ReseedDemoDataResponse?> HandleAsync(string? presentedKey, CancellationToken ct)
    {
        if (!KeyMatches(presentedKey, options.Value.ReseedKey))
        {
            logger.DemoReseedRefused();
            return null;
        }

        var outcome = await db.Database.CreateExecutionStrategy().ExecuteAsync(ReseedAsync, ct);
        logger.DemoDataReseeded(outcome.AppointmentsDeleted, outcome.AppointmentsCreated);
        return outcome;
    }

    /// <summary>
    /// Compares in fixed time (<see cref="CryptographicOperations.FixedTimeEquals"/>), over SHA-256 digests so that neither the key's
    /// content nor its length shows in the response time. No configured key matches nothing.
    /// </summary>
    internal static bool KeyMatches(string? presented, string? expected)
    {
        if (presented is null || string.IsNullOrEmpty(expected))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(presented)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
    }

    private async Task<ReseedDemoDataResponse> ReseedAsync(CancellationToken ct)
    {
        // A retried run starts from nothing: whatever the failed run tracked or staged is gone with its transaction.
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        foreach (var dealershipId in DemoDealerships)
        {
            await DealershipLock.AcquireAsync(db, dealershipId, ct);
        }

        var appointments = db.Appointments.Where(a => DemoDealerships.Contains(a.DealershipId));
        await db.IdempotencyKeys.Where(k => appointments.Any(a => a.Id == k.ResourceId)).ExecuteDeleteAsync(ct);
        await db.AppointmentHistory.Where(h => appointments.Any(a => a.Id == h.AppointmentId)).ExecuteDeleteAsync(ct);
        var deleted = await appointments.ExecuteDeleteAsync(ct);

        await ReferenceDataSeed.EnsureSeededAsync(db, clock, ct);
        await ReferenceDataSeed.RestoreSeededCompetenceAsync(db, ct);
        await ReferenceDataSeed.RestoreSeededDamageCertificationAsync(db, ct);
        var created = await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, clock, ct);

        await transaction.CommitAsync(ct);
        return new ReseedDemoDataResponse(deleted, created);
    }
}

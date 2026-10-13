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
/// Resets demo dealerships to their initial seeded state and re-creates the deterministic demo week of appointments within a single transaction.
/// </summary>
public sealed class ReseedDemoDataHandler(SchedulerDbContext db, TimeProvider clock, IOptions<DemoOptions> options, ILogger<ReseedDemoDataHandler> logger)
{
    private static readonly Guid[] DemoDealerships = [ReferenceDataSeed.ReadingDealershipId, ReferenceDataSeed.MunichDealershipId];

    /// <returns>What was deleted and created, or null when <paramref name="presentedKey"/> is missing or wrong.</returns>
    public async Task<ReseedDemoDataResponse?> HandleAsync(string? presentedKey, CancellationToken ct)
    {
        if (!KeyMatches(presentedKey, options.Value.ReseedKey))
        {
            logger.DemoReseedRefused();
            return null;
        }

        var (outcome, reference) = await db.Database.CreateExecutionStrategy().ExecuteAsync(ReseedAsync, ct);
        reference.LogPublished(logger);
        logger.DemoDataReseeded(outcome.AppointmentsDeleted, outcome.AppointmentsCreated);
        return outcome;
    }

    /// <summary>Compares the presented and expected keys in fixed time over SHA-256 digests.</summary>
    internal static bool KeyMatches(string? presented, string? expected)
    {
        if (presented is null || string.IsNullOrEmpty(expected))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(presented)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
    }

    private async Task<(ReseedDemoDataResponse Outcome, ReferenceSeedResult Reference)> ReseedAsync(CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await SeedingLock.AcquireAsync(db, ct);
        foreach (var dealershipId in DemoDealerships)
        {
            await DealershipLock.AcquireAsync(db, dealershipId, ct);
        }

        var appointments = db.Appointments.Where(a => DemoDealerships.Contains(a.DealershipId));
        await db.IdempotencyKeys.Where(k => appointments.Any(a => a.Id == k.ResourceId)).ExecuteDeleteAsync(ct);
        await db.AppointmentHistory.Where(h => appointments.Any(a => a.Id == h.AppointmentId)).ExecuteDeleteAsync(ct);
        var deleted = await appointments.ExecuteDeleteAsync(ct);

        var reference = await ReferenceDataSeed.EnsureSeededAsync(db, clock, ct);
        await ReferenceDataSeed.RestoreSeededCompetenceAsync(db, ct);
        await ReferenceDataSeed.RestoreSeededDamageCertificationAsync(db, ct);
        var created = await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, clock, ct);

        await transaction.CommitAsync(ct);
        return (new ReseedDemoDataResponse(deleted, created), reference);
    }
}

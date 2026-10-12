using Keyloop.ServiceScheduler.Api.Features.Dealerships.Mapping;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;

/// <summary>Every dealership with its weekly operating hours (FR-1), ordered by name.</summary>
public sealed class GetDealershipsHandler(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<DealershipResponse>> HandleAsync(CancellationToken ct)
    {
        // Sorted by PostgreSQL in the database's default collation, en_US.utf8 in the postgres:17 image that every environment runs
        // (linguistic; it agrees with ordinal order for the catalogue's names), then by id so equal names keep a stable order.
        var dealerships = await db.Dealerships.AsNoTracking().OrderBy(d => d.Name).ThenBy(d => d.Id).ToListAsync(ct);
        return [.. dealerships.Select(DealershipMapper.ToResponse)];
    }
}

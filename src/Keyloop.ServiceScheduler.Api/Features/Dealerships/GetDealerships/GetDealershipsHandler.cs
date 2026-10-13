using Keyloop.ServiceScheduler.Api.Features.Dealerships.Mapping;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;

/// <summary>Lists all dealerships with their weekly operating hours, ordered by name.</summary>
public sealed class GetDealershipsHandler(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<DealershipResponse>> HandleAsync(CancellationToken ct)
    {
        var dealerships = await db.Dealerships.AsNoTracking().OrderBy(d => d.Name).ThenBy(d => d.Id).ToListAsync(ct);
        return [.. dealerships.Select(DealershipMapper.ToResponse)];
    }
}

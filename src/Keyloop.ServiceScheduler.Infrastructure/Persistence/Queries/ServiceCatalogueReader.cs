using Keyloop.ServiceScheduler.Domain.Catalog;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;

public sealed record ServiceCatalogueEntry(ServiceType ServiceType, bool Bookable);

/// <summary>Shared catalogue bookability: an active qualifying bay AND an active qualifying technician.</summary>
public sealed class ServiceCatalogueReader(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<ServiceCatalogueEntry>> ReadAsync(Guid dealershipId, CancellationToken ct)
    {
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealershipId && b.IsActive).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId && t.IsActive).ToListAsync(ct);
        var serviceTypes = await db.ServiceTypes.AsNoTracking().OrderBy(s => s.Name).ThenBy(s => s.Code).ToListAsync(ct);
        return [.. serviceTypes.Select(service => new ServiceCatalogueEntry(service,
            bays.Exists(b => b.Supports(service)) && technicians.Exists(t => t.IsCertifiedFor(service))))];
    }
}

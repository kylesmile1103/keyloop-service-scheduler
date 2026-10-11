using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Catalog.Mapping;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;

/// <summary>
/// The whole service catalogue (service types are global), ordered by name, with <see cref="ServiceTypeResponse.Bookable"/>
/// computed for one dealership. Throws <see cref="NotFoundException"/> (404 <c>not-found</c>) for an unknown dealership.
/// </summary>
public sealed class GetServiceTypesHandler(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<ServiceTypeResponse>> HandleAsync(Guid dealershipId, CancellationToken ct)
    {
        if (!await db.Dealerships.AnyAsync(d => d.Id == dealershipId, ct))
        {
            throw new NotFoundException(ProblemResources.Dealership, dealershipId);
        }

        // A fixed number of reads whatever the catalogue's size: the dealership's active resources once, then Bookable in memory
        // through the domain's all-of rules (ServiceBay.Supports, Technician.IsCertifiedFor).
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealershipId && b.IsActive).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId && t.IsActive).ToListAsync(ct);

        // Name order in the database's default collation (see GetDealershipsHandler); Code is unique, so the order is total.
        var serviceTypes = await db.ServiceTypes.AsNoTracking().OrderBy(s => s.Name).ThenBy(s => s.Code).ToListAsync(ct);

        return
        [
            .. serviceTypes.Select(serviceType => ServiceTypeMapper.ToResponse(
                serviceType,
                bookable: bays.Exists(bay => bay.Supports(serviceType)) && technicians.Exists(technician => technician.IsCertifiedFor(serviceType)))),
        ];
    }
}

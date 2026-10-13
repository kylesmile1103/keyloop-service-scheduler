using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Catalog.Mapping;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;

/// <summary>
/// The whole service catalogue (service types are global), ordered by name, with <see cref="ServiceTypeResponse.Bookable"/>
/// computed for one dealership. Throws <see cref="NotFoundException"/> (404 <c>not-found</c>) for an unknown dealership.
/// </summary>
public sealed class GetServiceTypesHandler(SchedulerDbContext db, ServiceCatalogueReader catalogue, TimeProvider clock, IOptions<SchedulingOptions> options)
{
    public async Task<IReadOnlyList<ServiceTypeResponse>> HandleAsync(Guid dealershipId, CancellationToken ct)
    {
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealershipId, ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, dealershipId);

        var localDate = LocalTimeConverter.ToLocalDate(clock.GetUtcNow().UtcDateTime, dealership.TimeZone);
        var entries = await catalogue.ReadAsync(dealershipId, options.Value.VehicleAwareRequirements, localDate, ct);
        return [.. entries.Select(entry => ServiceTypeMapper.ToResponse(entry.ServiceType, entry.Bookable))];
    }
}

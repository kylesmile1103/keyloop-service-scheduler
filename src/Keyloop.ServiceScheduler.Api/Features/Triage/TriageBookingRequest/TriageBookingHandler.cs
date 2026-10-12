using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

public sealed class TriageBookingHandler(SchedulerDbContext db, ServiceCatalogueReader catalogue, CloudflareTriageClient client,
    TimeProvider clock, IOptions<TriageConnectionOptions> connection, IOptions<TriageOptions> options, IOptions<SchedulingOptions> scheduling)
{
    public async Task<TriageBookingResponse> HandleAsync(Guid dealershipId, TriageBookingRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!connection.Value.Enabled)
        {
            throw new TriageUnavailableException("disabled");
        }
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealershipId, ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, dealershipId);
        var entries = await catalogue.ReadAsync(dealershipId, ct);
        var services = entries.Where(e => e.Bookable).Select(e => e.ServiceType).ToList();
        var input = JevQuestionBuilder.Build(connection.Value.Model, request.Description, services, dealership, clock, scheduling.Value.BookingHorizonDays);
        var answer = await client.EvaluateAsync(input, ct);
        Activity.Current?.SetTag("triage.input_tokens", answer.InputTokens);
        return TriageResponseMapper.Map(connection.Value.Model, answer, services, options.Value);
    }
}

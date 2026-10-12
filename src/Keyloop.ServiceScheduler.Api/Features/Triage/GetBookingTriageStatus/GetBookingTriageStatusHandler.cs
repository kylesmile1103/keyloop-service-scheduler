using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;

public sealed class GetBookingTriageStatusHandler(IOptions<TriageConnectionOptions> connection, IOptions<TriageOptions> options)
{
    public BookingTriageStatusResponse Handle() => new(connection.Value.Enabled, connection.Value.Model,
        "Jev by TypeSafe via Cloudflare AI Gateway", options.Value.MaxDescriptionLength);
}

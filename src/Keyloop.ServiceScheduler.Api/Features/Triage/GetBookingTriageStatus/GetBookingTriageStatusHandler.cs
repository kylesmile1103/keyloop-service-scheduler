using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;

public sealed class GetBookingTriageStatusHandler(IOptions<TriageConnectionOptions> connection, IOptions<TriageOptions> options)
{
    public BookingTriageStatusResponse Handle() => new(connection.Value.Enabled, connection.Value.Model,
        connection.Value.Model == "@cf/cloudflare/clef-flash" ? "Clef-flash via Cloudflare AI Gateway" : "Clef via Cloudflare AI Gateway", options.Value.MaxDescriptionLength,
        connection.Value.Enabled && connection.Value.ImagesEnabled, TriageImageLimits.MaxImages,
        TriageImageLimits.MaxImageBytes, TriageImageLimits.MaxTotalImageBytes);
}

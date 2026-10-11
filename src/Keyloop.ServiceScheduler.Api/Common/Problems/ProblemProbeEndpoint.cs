using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>
/// <c>GET /api/v1/__throw?kind=…</c>, mapped only in the SystemTest environment and excluded from the OpenAPI document (Addendum B
/// §B1). It throws each exception <see cref="GlobalExceptionHandler"/> maps, with extension values of the same runtime types the
/// domain and handlers use, so the integration suite proves every problem shape serialises under reflection-free JSON.
/// <c>kind=ok</c> returns 204 (a cheap endpoint for header, CORS and rate-limit tests); <c>kind=actor</c> returns the request's
/// <see cref="CurrentActor"/> name (forwarded-headers tests).
/// </summary>
internal sealed class ProblemProbeEndpoint : IEndpoint
{
    private static readonly DateTime Nine = new(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc);

    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/__throw", Throw).ExcludeFromDescription();

    internal static Results<NoContent, Ok<string>> Throw(string kind, [FromServices] CurrentActor actor) => kind switch
    {
        "ok" => TypedResults.NoContent(),
        "actor" => TypedResults.Ok(actor.Name),
        "rule" => throw new DomainRuleViolationException(
            "outside-operating-hours", "The slot is outside the dealership's operating hours.",
            new Dictionary<string, object?> { ["operatingWindow"] = new OperatingWindow(Nine.AddHours(-2), Nine.AddHours(8)) }),
        "lead-time" => throw new DomainRuleViolationException(
            "lead-time-not-met", "Appointments must start at least 60 minutes from now.",
            new Dictionary<string, object?> { ["earliestStartUtc"] = new DateTime(2026, 10, 12, 9, 0, 0, DateTimeKind.Utc) }),
        "aligned" => throw new DomainRuleViolationException(
            "slot-not-aligned", "Start times must fall on the 15-minute grid that begins at opening time.",
            new Dictionary<string, object?> { ["slotGranularityMinutes"] = 15 }),
        "qualified" => throw new DomainRuleViolationException(
            "no-qualified-resources", "The selected bay or technician cannot perform this service at this dealership.",
            new Dictionary<string, object?>
            {
                ["missingCapabilities"] = new[] { BayCapability.EvHighVoltage },
                ["missingCertifications"] = new[] { Certification.HighVoltageElectrical },
            }),
        "unavailable" => throw new SlotUnavailableException(new List<SuggestedSlot> { Suggestion(Nine), Suggestion(Nine.AddHours(1)) }),
        "conflict" => throw new SlotConflictException("technician", new List<SuggestedSlot> { Suggestion(Nine) }),
        "transition" => throw new InvalidStateTransitionException(AppointmentStatus.Cancelled, "cancel"),
        "not-found" => throw new NotFoundException("appointment", Guid.Parse("0199d2a4-0000-7000-8000-000000000001")),
        "idempotency" => throw new IdempotencyKeyReuseException(),
        "concurrency" => throw new DbUpdateConcurrencyException("Simulated stale row version."),
        _ => throw new InvalidOperationException("Simulated failure: Host=db;Password=do-not-leak"),
    };

    private static SuggestedSlot Suggestion(DateTime startUtc) =>
        new(startUtc, startUtc.AddHours(1), startUtc.AddHours(1).ToString("yyyy-MM-dd'T'HH:mm:ss'+01:00'", System.Globalization.CultureInfo.InvariantCulture));
}

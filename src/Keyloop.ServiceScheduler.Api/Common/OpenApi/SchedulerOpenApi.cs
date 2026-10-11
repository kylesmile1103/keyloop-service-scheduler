using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>The fixed operation tags (Addendum B §B2). Every endpoint declares exactly one with <c>.WithTags(ApiTags.…)</c>.</summary>
public static class ApiTags
{
    public const string Dealerships = "Dealerships";
    public const string Catalog = "Catalog";
    public const string Availability = "Availability";
    public const string Appointments = "Appointments";
    public const string Schedule = "Schedule";
}

/// <summary>
/// The <c>v1</c> OpenAPI document: fixed info, tags in a fixed order with descriptions, and no <c>servers</c> (Scalar uses the
/// current origin, and the build-time document must not depend on the host).
/// </summary>
internal static class SchedulerOpenApi
{
    public const string DocumentName = "v1";

    private const string Description =
        """
        Books multi-resource workshop appointments: each booking reserves a service bay with the required capabilities and a
        technician with the required certifications for the same time slot, and never double-books either, even under concurrent requests.

        Every error is an RFC 9457 problem (`application/problem+json`) with a stable `type` under
        `https://api.keyloop.example/problems/` and a `traceId`. Branch on `type`, not on text:

        - **400** — the request is malformed (`validation-error`).
        - **422** — the request is well-formed but breaks a business rule given current reference data (for example
          `outside-operating-hours`, `lead-time-not-met`, `no-qualified-resources`).
        - **409** — the request collides with current state (`slot-unavailable`, `slot-conflict`, `invalid-state-transition`,
          `concurrency-conflict`).
        - **429** — rate limited (`rate-limited`, with `Retry-After`).

        The full problem catalogue is in `docs/SYSTEM_DESIGN.md`, section 8.7 (API contract).
        """;

    private static readonly (string Name, string Description)[] Tags =
    [
        (ApiTags.Dealerships, "Dealerships, their time zones and weekly operating hours."),
        (ApiTags.Catalog, "Service types a dealership offers, with the bay capabilities and technician certifications each requires."),
        (ApiTags.Availability, "Feasible start times for a service on a dealership's local date."),
        (ApiTags.Appointments, "Book, read and cancel appointments."),
        (ApiTags.Schedule, "The dispatch board: a dealership's bays, technicians and appointments for one day."),
    ];

    public static IServiceCollection AddSchedulerOpenApi(this IServiceCollection services) =>
        services.AddOpenApi(DocumentName, options => options.AddDocumentTransformer(TransformDocument));

    private static Task TransformDocument(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        document.Info = new OpenApiInfo
        {
            Title = "Keyloop Unified Service Scheduler API",
            Version = DocumentName,
            Description = Description.ReplaceLineEndings("\n"),
        };
        document.Servers = [];

        // Fixed order first; a tag outside the list (a review miss) is kept rather than silently dropped.
        var tags = new HashSet<OpenApiTag>(Tags.Select(tag => new OpenApiTag { Name = tag.Name, Description = tag.Description }));
        foreach (var extra in document.Tags ?? Enumerable.Empty<OpenApiTag>())
        {
            if (!Tags.Any(tag => tag.Name == extra.Name))
            {
                tags.Add(extra);
            }
        }

        document.Tags = tags;
        return Task.CompletedTask;
    }
}

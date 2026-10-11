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

    internal static Task TransformDocument(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        document.Info = new OpenApiInfo
        {
            Title = "Keyloop Unified Service Scheduler API",
            Version = DocumentName,
            Description = Description.ReplaceLineEndings("\n"),
        };
        document.Servers = [];

        // The order is explicit (a sorted set ranked by the fixed list), not a hash set's enumeration order, so the build-time document
        // is byte-stable. A tag outside the list (a review miss) is kept after the fixed ones, by name, rather than silently dropped.
        var tags = new SortedSet<OpenApiTag>(TagOrder.Instance);
        foreach (var (name, description) in Tags)
        {
            tags.Add(new OpenApiTag { Name = name, Description = description });
        }

        foreach (var extra in document.Tags ?? Enumerable.Empty<OpenApiTag>())
        {
            tags.Add(extra); // a fixed tag compares equal to its listed entry, which is kept
        }

        document.Tags = tags;
        return Task.CompletedTask;
    }

    private sealed class TagOrder : IComparer<OpenApiTag>
    {
        public static readonly TagOrder Instance = new();

        public int Compare(OpenApiTag? x, OpenApiTag? y)
        {
            var byRank = Rank(x).CompareTo(Rank(y));
            return byRank != 0 ? byRank : string.CompareOrdinal(x?.Name, y?.Name);
        }

        private static int Rank(OpenApiTag? tag)
        {
            var index = Array.FindIndex(Tags, fixedTag => fixedTag.Name == tag?.Name);
            return index < 0 ? Tags.Length : index;
        }
    }
}

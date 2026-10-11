using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Mvc.Infrastructure;
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
/// The <c>v1</c> OpenAPI document: fixed info, tags in a fixed order with descriptions, no <c>servers</c> (Scalar uses the
/// current origin, and the build-time document must not depend on the host), and <c>format: date</c> on date parameters bound as text.
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
        services.AddOpenApi(DocumentName, options => options
            .AddDocumentTransformer(TransformDocument)
            .AddSchemaTransformer(TransformParameterSchema)
            .AddOperationTransformer(AddResponseHeaders));

    /// <summary>Adds the response headers endpoints declare with <see cref="ResponseHeaderExtensions.WithResponseHeader"/> (e.g. <c>Location</c> on a 201).</summary>
    internal static Task AddResponseHeaders(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken cancellationToken)
    {
        foreach (var header in context.Description.ActionDescriptor.EndpointMetadata.OfType<ResponseHeaderMetadata>())
        {
            if (operation.Responses?.GetValueOrDefault(header.StatusCode.ToString(CultureInfo.InvariantCulture)) is not OpenApiResponse response)
            {
                throw new InvalidOperationException(
                    $"Operation '{operation.OperationId}' documents header {header.Name} for status {header.StatusCode}, which it does not declare.");
            }

            response.Headers ??= new Dictionary<string, IOpenApiHeader>();
            response.Headers[header.Name] = new OpenApiHeader
            {
                Description = header.Description,
                Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = header.Format },
            };
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// A parameter marked <c>[DataType(DataType.Date)]</c> is documented as an RFC 3339 full-date (<c>type: string, format: date</c>),
    /// as a <see cref="DateOnly"/> parameter would be. Such parameters bind as text so that the validator can reject any other form
    /// with a field error (e.g. <c>GetAvailabilityQuery.Date</c>); Microsoft.AspNetCore.OpenApi does not map the attribute itself.
    /// </summary>
    internal static Task TransformParameterSchema(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.ParameterDescription?.ParameterDescriptor is IParameterInfoParameterDescriptor { ParameterInfo: var parameter }
            && parameter.GetCustomAttributes(typeof(DataTypeAttribute), inherit: true).OfType<DataTypeAttribute>().Any(a => a.DataType == DataType.Date))
        {
            schema.Format = "date";
        }

        return Task.CompletedTask;
    }

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

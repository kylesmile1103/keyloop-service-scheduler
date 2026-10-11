using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;
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
/// current origin, and the build-time document must not depend on the host), <c>format: date</c> on date parameters bound as text,
/// string-typed enums, the <c>traceId</c> every problem carries, documented response headers, and request bodies described by their
/// own parameter. The same document is written at build time to <c>contracts/openapi/v1.json</c>, from which the web client is generated.
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

        - **400** - the request is malformed (`validation-error`).
        - **422** - the request is well-formed but breaks a business rule given current reference data (for example
          `outside-operating-hours`, `lead-time-not-met`, `no-qualified-resources`).
        - **409** - the request collides with current state (`slot-unavailable`, `slot-conflict`, `invalid-state-transition`,
          `concurrency-conflict`).
        - **429** - rate limited (`rate-limited`, with `Retry-After`).

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

    private const string TraceIdProperty = "traceId";

    private const string TraceIdDescription =
        "The request's W3C trace context (traceparent form, e.g. 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01). Quote it "
        + "when reporting a problem: it finds the request's trace and logs.";

    // The XML-comment generator's transformers are registered before these (it intercepts AddOpenApi and adds its own first), so
    // these run after them and can correct what they write (DescribeRequestBody).
    public static IServiceCollection AddSchedulerOpenApi(this IServiceCollection services) =>
        services.AddOpenApi(DocumentName, options => options
            .AddDocumentTransformer(TransformDocument)
            .AddSchemaTransformer(TransformParameterSchema)
            .AddSchemaTransformer(TypeStringEnums)
            .AddSchemaTransformer(DocumentProblemTraceId)
            .AddOperationTransformer(AddResponseHeaders)
            .AddOperationTransformer(DocumentRequestCorrelation)
            .AddOperationTransformer(DescribeRequestBody));

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
                Schema = new OpenApiSchema { Type = header.Type, Format = header.Format },
            };
        }

        return Task.CompletedTask;
    }

    /// <summary>Documents the middleware's optional UUID input and mandatory echo on every declared response, including problems.</summary>
    internal static Task DocumentRequestCorrelation(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken cancellationToken)
    {
        operation.Parameters ??= [];
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = RequestCorrelationMiddleware.HeaderName,
            In = ParameterLocation.Header,
            Required = false,
            Description = "Optional request correlation UUID (36 characters, hyphenated). Missing, malformed or multiple values generate a new UUID; the response echoes the accepted or generated id.",
            Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid", MinLength = 36, MaxLength = 36 },
        });
        foreach (var response in operation.Responses?.Values.OfType<OpenApiResponse>() ?? [])
        {
            response.Headers ??= new Dictionary<string, IOpenApiHeader>();
            response.Headers[RequestCorrelationMiddleware.HeaderName] = new OpenApiHeader
            {
                Description = "The accepted or generated request correlation UUID, also recorded on the server Activity and in log scopes.",
                Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uuid" },
            };
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// Puts back the request body's own description. Microsoft.AspNetCore.OpenApi 10.0's XML-comment transformer copies the text of
    /// every <c>&lt;param&gt;</c> that names no operation parameter - the body, but also injected services, the cancellation token and a
    /// header bound under another name - onto the request body, so whichever such tag comes last describes it. The description comes
    /// from the body parameter's <c>[Description]</c> attribute instead; a body without one fails document generation, and so the build.
    /// </summary>
    internal static Task DescribeRequestBody(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken cancellationToken)
    {
        if (operation.RequestBody is not { } requestBody)
        {
            return Task.CompletedTask;
        }

        var body = context.Description.ParameterDescriptions.SingleOrDefault(p => p.Source == BindingSource.Body);
        var description = (body?.ParameterDescriptor as IParameterInfoParameterDescriptor)?.ParameterInfo
            .GetCustomAttributes(typeof(DescriptionAttribute), inherit: false).OfType<DescriptionAttribute>().SingleOrDefault()?.Description;
        requestBody.Description = description ?? throw new InvalidOperationException(
            $"Operation '{operation.OperationId}' has a request body: describe it with [Description] on the body parameter (see SchedulerOpenApi.DescribeRequestBody).");
        return Task.CompletedTask;
    }

    /// <summary>
    /// Adds <c>type: string</c> to enum schemas. Enums are written by name (<c>UseStringEnumConverter</c> on <c>SchedulerJsonContext</c>)
    /// and their schemas list the names, but Microsoft.AspNetCore.OpenApi leaves out the type; a schema whose values are not all
    /// strings (an enum written as a number) is left alone.
    /// </summary>
    internal static Task TypeStringEnums(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.JsonTypeInfo.Type.IsEnum && schema.Enum is { Count: > 0 } values && values.All(v => v?.GetValueKind() == JsonValueKind.String))
        {
            schema.Type = JsonSchemaType.String;
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Documents <c>traceId</c>, as required, on <c>ProblemDetails</c> and <c>HttpValidationProblemDetails</c>: every problem this API
    /// writes carries it (SYSTEM_DESIGN §8.7; the problem-details service adds it), but the framework's schemas list only the RFC 9457
    /// members, so a generated client would not know it is there.
    /// </summary>
    internal static Task DocumentProblemTraceId(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (typeof(ProblemDetails).IsAssignableFrom(context.JsonTypeInfo.Type))
        {
            schema.Properties ??= new Dictionary<string, IOpenApiSchema>();
            schema.Properties[TraceIdProperty] = new OpenApiSchema { Type = JsonSchemaType.String, Description = TraceIdDescription };
            schema.Required ??= new HashSet<string>(StringComparer.Ordinal);
            schema.Required.Add(TraceIdProperty);
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

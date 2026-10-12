using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Microsoft.AspNetCore.Authorization;
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
    public const string Features = "Features";
    public const string Admin = "Admin";
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

        Public reads are anonymous. Customer names, VINs and registrations are masked unless the caller has an API role. Writes
        require Admin or ServiceAdvisor; appointment details require any API role. Access signs in at `/auth/login`; `/api/v1/me`
        discovers the caller. Resource and policy edits, their reads and audit history require Admin.

        - **401** - sign-in required (`unauthenticated`, with `loginUrl`).
        - **403** - the caller has no permitted role (`forbidden`).
        - **400** - the request is malformed (`validation-error`).
        - **422** - the request is well-formed but breaks a business rule given current reference data (for example
          `outside-operating-hours`, `lead-time-not-met`, `no-qualified-resources`).
        - **409** - the request collides with current state (`slot-unavailable`, `slot-conflict`, `invalid-state-transition`,
          `concurrency-conflict`).
        - **412** - Admin edit used a stale ETag (`precondition-failed`, with `current` and `currentETag`).
        - **428** - Admin edit requires `If-Match` (`precondition-required`).
        - **429** - rate limited (`rate-limited`, with `Retry-After`).

        The full problem catalogue is in `docs/ARCHITECTURE.md`, section 8.7 (API contract).
        """;

    private static readonly (string Name, string Description)[] Tags =
    [
        (ApiTags.Dealerships, "Dealerships, their time zones and weekly operating hours."),
        (ApiTags.Catalog, "Service types a dealership offers, with the bay capabilities and technician certifications each requires."),
        (ApiTags.Availability, "Feasible start times for a service on a dealership's local date."),
        (ApiTags.Appointments, "Book, read and cancel appointments."),
        ("Identity", "The current caller, API roles and hosted Access navigation URLs."),
        (ApiTags.Schedule, "The dispatch board: a dealership's bays, technicians and appointments for one day."),
        (ApiTags.Features, "Environment-wide switches for client rendering, identical for every caller."),
        (ApiTags.Admin, "Admin-only resource editing, typed policy previews and change history."),
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
            .AddSchemaTransformer(DescribeExactEnumNames)
            .AddSchemaTransformer(Features.Admin.Shared.AdminOpenApiExamples.DescribeAsync)
            .AddSchemaTransformer(DocumentProblemTraceId)
            .AddOperationTransformer(DocumentAccessSecurity)
            .AddOperationTransformer(AddResponseHeaders)
            .AddOperationTransformer(DocumentRequestCorrelation)
            .AddOperationTransformer(DescribeRequestBody));

    internal static Task DocumentAccessSecurity(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken cancellationToken)
    {
        // Deny by default (SchedulerAuthentication's fallback policy): only an explicitly anonymous operation is public.
        var protectedRoute = !context.Description.ActionDescriptor.EndpointMetadata.OfType<IAllowAnonymous>().Any();
        operation.Security =
        [
            new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("CloudflareAccess", context.Document)] = [] },
            new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("AccessCookie", context.Document)] = [] },
        ];
        if (!protectedRoute)
        {
            operation.Security.Insert(0, new OpenApiSecurityRequirement());
        }
        return Task.CompletedTask;
    }

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
    /// A request property read by <see cref="ExactEnumNameConverter{TEnum}"/> is still the string enum it was: Microsoft.AspNetCore.OpenApi
    /// cannot see through a custom converter and would leave the schema untyped, so the type and the member names are written here
    /// (with <c>null</c> as well for a nullable property).
    /// </summary>
    internal static Task DescribeExactEnumNames(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.JsonPropertyInfo is { AttributeProvider: { } arrayMember, PropertyType.IsArray: true } arrayProperty
            && arrayMember.GetCustomAttributes(typeof(JsonConverterAttribute), inherit: false).OfType<JsonConverterAttribute>()
                .Any(a => a.ConverterType is { IsGenericType: true } converter && converter.GetGenericTypeDefinition() == typeof(ExactEnumNameArrayConverter<>)))
        {
            schema.Type = JsonSchemaType.Array;
            schema.Items = new OpenApiSchema
            {
                Type = JsonSchemaType.String,
                Enum = Enum.GetNames(arrayProperty.PropertyType.GetElementType()!).Select(name => (JsonNode)JsonValue.Create(name)).ToList(),
            };
        }

        // The attribute, not the converter instance: a nullable property's converter is the framework's wrapper around ours.
        if (context.JsonPropertyInfo is { AttributeProvider: { } member } property
            && member.GetCustomAttributes(typeof(JsonConverterAttribute), inherit: false).OfType<JsonConverterAttribute>()
                .Any(a => a.ConverterType is { IsGenericType: true } converter && converter.GetGenericTypeDefinition() == typeof(ExactEnumNameConverter<>)))
        {
            var underlying = Nullable.GetUnderlyingType(property.PropertyType);
            var values = Enum.GetNames(underlying ?? property.PropertyType).Select(name => (JsonNode)JsonValue.Create(name)).ToList();
            if (underlying is not null)
            {
                values.Add(null!); // JSON null, as the framework lists it for a nullable enum
            }

            schema.Type = underlying is null ? JsonSchemaType.String : JsonSchemaType.String | JsonSchemaType.Null;
            schema.Enum = values;
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Documents <c>traceId</c>, as required, on <c>ProblemDetails</c> and <c>HttpValidationProblemDetails</c>: every problem this API
    /// writes carries it (ARCHITECTURE §8.7; the problem-details service adds it), but the framework's schemas list only the RFC 9457
    /// members, so a generated client would not know it is there.
    /// </summary>
    internal static Task DocumentProblemTraceId(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (typeof(ProblemDetails).IsAssignableFrom(context.JsonTypeInfo.Type))
        {
            schema.Properties ??= new Dictionary<string, IOpenApiSchema>();
            schema.Properties[TraceIdProperty] = new OpenApiSchema { Type = JsonSchemaType.String, Description = TraceIdDescription };
            schema.Properties["loginUrl"] = new OpenApiSchema
            {
                Type = JsonSchemaType.String,
                Description = "Present on 401 unauthenticated problems: same-origin Access login path with an encoded local returnTo. Navigate the browser to this URL.",
            };
            schema.Properties["minimumHvLevel"] = new OpenApiSchema
            {
                Type = JsonSchemaType.Integer, Minimum = "0", Maximum = "4",
                Description = "Vehicle-aware no-qualified-resources: the resolved minimum HV competence level.",
            };
            schema.Properties["requiredBrand"] = new OpenApiSchema
            {
                Type = JsonSchemaType.String | JsonSchemaType.Null,
                Description = "Reserved for a later brand rule; null on vehicle-aware no-qualified-resources in Phase 1.",
            };
            schema.Properties["firedRules"] = new OpenApiSchema
            {
                Type = JsonSchemaType.Array, Items = new OpenApiSchema { Type = JsonSchemaType.String },
                Description = "Vehicle-aware no-qualified-resources: policy rule codes in deterministic order.",
            };
            schema.Properties["conflictingAttributes"] = new OpenApiSchema
            {
                Type = JsonSchemaType.Array, Items = new OpenApiSchema { Type = JsonSchemaType.String },
                Description = "vehicle-profile-conflict: attributes whose declarations disagree with decoded evidence.",
            };
            schema.Properties["rejectedFields"] = new OpenApiSchema
            {
                Type = JsonSchemaType.Array, Items = new OpenApiSchema { Type = JsonSchemaType.String },
                Description = "vehicle-aware-requirements-disabled: the vehicle-aware inputs the request carried, which this deployment cannot honour.",
            };
            schema.Properties["currentETag"] = new OpenApiSchema
            {
                Type = JsonSchemaType.String, Description = "On 412 precondition-failed, the current strong ETag, including quotes. Also sent as the ETag header.",
            };
            schema.Properties["current"] = new OpenApiSchema
            {
                Description = "On 412 precondition-failed, the current Admin resource or policy representation.",
            };
            schema.Required ??= new HashSet<string>(StringComparer.Ordinal);
            schema.Required.Add(TraceIdProperty);
        }

        return Task.CompletedTask;
    }

    /// <summary>The custom <see cref="DataTypeAttribute"/> name that documents a text parameter as a boolean.</summary>
    public const string BooleanDataType = "boolean";

    /// <summary>
    /// A parameter marked <c>[DataType(DataType.Date)]</c> is documented as an RFC 3339 full-date (<c>type: string, format: date</c>),
    /// as a <see cref="DateOnly"/> parameter would be; one marked <c>[EnumDataType(typeof(T))]</c> as the string enum of
    /// <c>T</c>'s member names; one marked <c>[DataType(BooleanDataType)]</c> as a boolean. Such parameters bind as text so that the
    /// validator can reject any other form with a field error (e.g. <c>GetAvailabilityQuery.Date</c>, <c>.Powertrain</c>,
    /// <c>.NeedsLiveDiagnosis</c>); Microsoft.AspNetCore.OpenApi does not map these attributes itself.
    /// </summary>
    internal static Task TransformParameterSchema(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.ParameterDescription?.ParameterDescriptor is not IParameterInfoParameterDescriptor { ParameterInfo: var parameter })
        {
            return Task.CompletedTask;
        }

        var dataTypes = parameter.GetCustomAttributes(typeof(DataTypeAttribute), inherit: true).OfType<DataTypeAttribute>().ToList();
        if (dataTypes.Any(a => a.DataType == DataType.Date))
        {
            schema.Format = "date";
        }

        // Text parameters the validator parses strictly (GetAvailabilityQuery): an enum's member names, and a boolean.
        if (dataTypes.OfType<EnumDataTypeAttribute>().FirstOrDefault() is { EnumType: { IsEnum: true } enumType })
        {
            schema.Type = JsonSchemaType.String;
            schema.Enum = [.. Enum.GetNames(enumType).Select(name => (JsonNode)JsonValue.Create(name))];
        }

        if (dataTypes.Any(a => a.DataType == DataType.Custom && a.CustomDataType == BooleanDataType))
        {
            schema.Type = JsonSchemaType.Boolean;
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
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes = new Dictionary<string, IOpenApiSecurityScheme>
        {
            ["CloudflareAccess"] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.ApiKey, In = ParameterLocation.Header, Name = "Cf-Access-Jwt-Assertion",
                Description = "Access application JWT, validated for RS256 signature, team issuer, configured AUD and lifetime. Forwarded by Access on protected paths; never accepts unsigned edge identity or token role claims.",
            },
            ["AccessCookie"] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.ApiKey, In = ParameterLocation.Cookie, Name = "CF_Authorization",
                Description = "Hostname-scoped Access application JWT from /auth/login (Cookie Path Attribute disabled). Validated by the API on public paths. Browser sends it automatically; header takes precedence.",
            },
        };

        // Add cross-schema unions after all endpoint schemas exist. A schema transform runs before later endpoints are generated.
        foreach (var name in new[] { "ProblemDetails", "HttpValidationProblemDetails" })
        {
            if (document.Components.Schemas is { } problemSchemas && problemSchemas.TryGetValue(name, out var problemSchema) && problemSchema is OpenApiSchema problem)
            {
                problem.Properties!["current"] = new OpenApiSchema
                {
                    Description = "On 412 precondition-failed, the current Admin resource or policy representation.",
                    OneOf = [new OpenApiSchemaReference("AdminTechnicianResponse", document),
                        new OpenApiSchemaReference("AdminBayResponse", document), new OpenApiSchemaReference("AdminPolicyResponse", document)],
                };
            }
        }
        if (document.Components.Schemas is { } auditSchemas && auditSchemas.TryGetValue("AdminHistoryItem", out var auditSchema) && auditSchema is OpenApiSchema history)
        {
            history.Properties!["before"] = new OpenApiSchema
            {
                Description = "Previous bounded reference state, null on creation. Shape follows resourceKind.",
                OneOf = [new OpenApiSchema { Type = JsonSchemaType.Null },
                    new OpenApiSchemaReference("TechnicianWriteRequest", document), new OpenApiSchemaReference("BayWriteRequest", document),
                    new OpenApiSchemaReference("AdminPolicyResponse", document)],
            };
            history.Properties["after"] = new OpenApiSchema
            {
                Description = "Committed bounded reference state. Shape follows resourceKind.",
                AnyOf = [new OpenApiSchemaReference("TechnicianWriteRequest", document), new OpenApiSchemaReference("BayWriteRequest", document),
                    new OpenApiSchemaReference("AdminPolicyResponse", document)],
            };
        }
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

using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Microsoft.AspNetCore.Authorization;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>Fixed OpenAPI operation tags.</summary>
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

/// <summary>Configures the <c>v1</c> OpenAPI document and its schema and operation transformers.</summary>
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

    /// <summary>Adds response headers declared with <see cref="ResponseHeaderExtensions.WithResponseHeader"/>.</summary>
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

    /// <summary>Documents the optional request correlation header parameter and response header on every operation.</summary>
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

    /// <summary>Sets the request body description from the body parameter's <see cref="DescriptionAttribute"/>.</summary>
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

    /// <summary>Adds <c>type: string</c> to string enum schemas.</summary>
    internal static Task TypeStringEnums(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.JsonTypeInfo.Type.IsEnum && schema.Enum is { Count: > 0 } values && values.All(v => v?.GetValueKind() == JsonValueKind.String))
        {
            schema.Type = JsonSchemaType.String;
        }

        return Task.CompletedTask;
    }

    /// <summary>Populates string enum schema types and member names for properties using <see cref="ExactEnumNameConverter{TEnum}"/>.</summary>
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

        if (context.JsonPropertyInfo is { AttributeProvider: { } member } property
            && member.GetCustomAttributes(typeof(JsonConverterAttribute), inherit: false).OfType<JsonConverterAttribute>()
                .Any(a => a.ConverterType is { IsGenericType: true } converter && converter.GetGenericTypeDefinition() == typeof(ExactEnumNameConverter<>)))
        {
            var underlying = Nullable.GetUnderlyingType(property.PropertyType);
            var values = Enum.GetNames(underlying ?? property.PropertyType).Select(name => (JsonNode)JsonValue.Create(name)).ToList();
            if (underlying is not null)
            {
                values.Add(null!);
            }

            schema.Type = underlying is null ? JsonSchemaType.String : JsonSchemaType.String | JsonSchemaType.Null;
            schema.Enum = values;
        }

        return Task.CompletedTask;
    }

    /// <summary>Documents <c>traceId</c> and problem extension properties on <see cref="ProblemDetails"/> schemas.</summary>
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

    /// <summary>Maps <see cref="DataTypeAttribute"/> and <see cref="EnumDataTypeAttribute"/> on text-bound query parameters to their OpenAPI schemas.</summary>
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

    private static List<JsonNode> Strings(IEnumerable<string> values) => [.. values.Select(value => (JsonNode)JsonValue.Create(value))];

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
        if (document.Components.Schemas is { } schemas)
        {
            if (schemas.TryGetValue("CompetenceWarningResponse", out var warning) && warning is OpenApiSchema { Properties: { } warningProperties }
                && warningProperties.TryGetValue("reasonCodes", out var reasonCodes) && reasonCodes is OpenApiSchema { Items: OpenApiSchema reasons })
            {
                reasons.Enum = Strings(CompetenceReasonCodes.All);
            }
            if (schemas.TryGetValue("AdminHistoryItem", out var item) && item is OpenApiSchema { Properties: { } itemProperties })
            {
                if (itemProperties.TryGetValue("resourceKind", out var kind) && kind is OpenApiSchema kindSchema) { kindSchema.Enum = Strings(AdminVocabulary.ResourceKinds); }
                if (itemProperties.TryGetValue("action", out var action) && action is OpenApiSchema actionSchema) { actionSchema.Enum = Strings(AdminVocabulary.Actions); }
            }
            schemas.Remove("JsonElement");
        }
        if (document.Paths?.Values.SelectMany(path => path.Operations?.Values ?? Enumerable.Empty<OpenApiOperation>())
                .SingleOrDefault(operation => operation.OperationId == "GetAdminHistory") is { Parameters: { } historyParameters }
            && historyParameters.SingleOrDefault(parameter => parameter.Name == "resourceKind")?.Schema is OpenApiSchema kindFilter)
        {
            kindFilter.Enum = Strings(AdminVocabulary.ResourceKinds);
        }

        var tags = new SortedSet<OpenApiTag>(TagOrder.Instance);
        foreach (var (name, description) in Tags)
        {
            tags.Add(new OpenApiTag { Name = name, Description = description });
        }

        foreach (var extra in document.Tags ?? Enumerable.Empty<OpenApiTag>())
        {
            tags.Add(extra);
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

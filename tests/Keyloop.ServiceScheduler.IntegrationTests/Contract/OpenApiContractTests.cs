using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.WebUtilities;

namespace Keyloop.ServiceScheduler.IntegrationTests.Contract;

/// <summary>
/// The OpenAPI contract (ADR-008, Addendum B §B1). <c>dotnet build</c> of the API writes <c>contracts/openapi/v1.json</c>, which is
/// committed and from which the dispatch board's client is generated (HeyAPI). These tests pin that the document the API serves at
/// runtime (SystemTest) is exactly that file, and that the file types the API precisely for a generator: stable operation ids,
/// string enums, problem responses, resolvable schemas, and required/nullable flags that say what the API actually writes.
/// </summary>
[Trait("Category", "Contract")]
public sealed class OpenApiContractTests(PostgresFixture pg) : IAsyncLifetime
{
    private const string Drift =
        "contract drift: run scripts/export-openapi.sh (dotnet build regenerates contracts/openapi/v1.json), then commit the file";

    /// <summary>Every operation, in route order.</summary>
    private static readonly string[] OperationIds =
        ["GetDealerships", "GetServiceTypes", "GetAvailability", "BookAppointment", "GetAppointment", "CancelAppointment", "GetWorkshopSchedule", "GetBookingTriageStatus", "TriageBookingRequest"];

    /// <summary>
    /// Every type a success response contains, as the serializer sees it. The API writes every property (the JSON context uses
    /// <c>JsonIgnoreCondition.Never</c>), and null only where the property is annotated nullable.
    /// </summary>
    private static readonly JsonTypeInfo[] ResponseTypes =
    [
        SchedulerJsonContext.Default.DealershipResponse,
        SchedulerJsonContext.Default.DayOperatingHoursResponse,
        SchedulerJsonContext.Default.ServiceTypeResponse,
        SchedulerJsonContext.Default.AvailabilityResponse,
        SchedulerJsonContext.Default.OperatingWindowResponse,
        SchedulerJsonContext.Default.AvailabilitySlotResponse,
        SchedulerJsonContext.Default.AppointmentResponse,
        SchedulerJsonContext.Default.ServiceTypeSummary,
        SchedulerJsonContext.Default.ResourceSummary,
        SchedulerJsonContext.Default.CustomerResponse,
        SchedulerJsonContext.Default.VehicleResponse,
        SchedulerJsonContext.Default.WorkshopScheduleResponse,
        SchedulerJsonContext.Default.DealershipSummary,
        SchedulerJsonContext.Default.BayScheduleResponse,
        SchedulerJsonContext.Default.ScheduledAppointmentResponse,
        SchedulerJsonContext.Default.TechnicianResponse,
        SchedulerJsonContext.Default.BookingTriageStatusResponse,
        SchedulerJsonContext.Default.TriageBookingResponse,
        SchedulerJsonContext.Default.TriageServiceCandidate,
        SchedulerJsonContext.Default.TriagePreferredDate,
    ];

    private static readonly JsonSerializerOptions Canonical = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary><c>contracts/openapi/v1.json</c> under the repository root (the directory holding the solution file).</summary>
    private static string ContractPath { get; } = LocateContract();

    public ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        _client = _factory.CreateClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Served_document_equals_the_committed_build_time_contract()
    {
        var served = JsonNode.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct))!;
        File.Exists(ContractPath).ShouldBeTrue($"{ContractPath} is missing. {Drift}");
        var committed = JsonNode.Parse(await File.ReadAllTextAsync(ContractPath, Ct))!;

        // Normalised JSON (formatting aside), compared in order: the build-time generator and the runtime document come from the same
        // composition root, so any difference - a value, a member, or the order of members - is drift or non-determinism.
        if (committed.ToJsonString(Canonical) != served.ToJsonString(Canonical))
        {
            var differences = Differences(committed, served, "$").Take(15).ToList();
            throw new ShouldAssertException($"{Drift}.{Environment.NewLine}{string.Join(Environment.NewLine, differences)}");
        }
    }

    [Fact]
    public async Task Every_operation_has_its_stable_operation_id()
    {
        var document = await ServedAsync();

        var operations = Operations(document).ToList();
        operations.Where(o => string.IsNullOrWhiteSpace(o.Operation["operationId"]?.GetValue<string>())).Select(o => o.Name)
            .ShouldBeEmpty("operations without an operationId (.WithName) - the generated client would invent a name");
        operations.Select(o => o.Operation["operationId"]!.GetValue<string>()).ShouldBe(OperationIds);
    }

    [Fact]
    public async Task Every_operation_documents_optional_request_id_and_echo_on_every_response()
    {
        var document = await ServedAsync();
        foreach (var operation in Operations(document))
        {
            var parameter = operation.Operation["parameters"].ShouldNotBeNull().AsArray()
                .Where(p => Text(p?["name"]) == "X-Request-Id").ShouldHaveSingleItem().ShouldNotBeNull();
            Text(parameter["in"]).ShouldBe("header");
            (parameter["required"]?.GetValue<bool>() ?? false).ShouldBeFalse();
            Text(parameter["schema"]?["format"]).ShouldBe("uuid");
            foreach (var response in operation.Operation["responses"]!.AsObject())
            {
                var header = (response.Value?["headers"]?["X-Request-Id"]).ShouldNotBeNull($"{operation.Name} {response.Key}");
                Text(header["schema"]?["type"]).ShouldBe("string");
                Text(header["schema"]?["format"]).ShouldBe("uuid");
                Text(header["description"]).ShouldNotBeNullOrWhiteSpace();
            }
        }
    }

    [Fact]
    public async Task Enums_are_string_valued_with_the_member_names()
    {
        var document = await ServedAsync();
        var schemas = document["components"]!["schemas"]!.AsObject();

        foreach (var (schema, names) in new (string, string[])[]
                 {
                     (nameof(AppointmentStatus), Enum.GetNames<AppointmentStatus>()),
                     (nameof(BayCapability), Enum.GetNames<BayCapability>()),
                     (nameof(Certification), Enum.GetNames<Certification>()),
                     (nameof(DayOfWeek), Enum.GetNames<DayOfWeek>()),
                 })
        {
            var enumSchema = schemas[schema].ShouldNotBeNull($"components.schemas.{schema}");
            Text(enumSchema["type"]).ShouldBe("string", schema);
            enumSchema["enum"].ShouldNotBeNull(schema).AsArray().Select(v => v!.GetValue<string>()).ShouldBe(names, schema);
        }

        // No integer-valued enum anywhere (a nullable enum may add null to its values).
        Descendants(document).Where(n => n.Name == "enum").SelectMany(n => n.Node!.AsArray())
            .Where(value => value is not null && value.GetValueKind() != JsonValueKind.String).Select(value => value!.ToJsonString())
            .ShouldBeEmpty("non-string enum values");
    }

    [Fact]
    public async Task Every_error_response_is_a_problem_document_with_a_trace_id()
    {
        var document = await ServedAsync();
        var schemas = document["components"]!["schemas"]!.AsObject();

        var errors = Operations(document)
            .SelectMany(o => o.Operation["responses"]!.AsObject().Where(r => r.Key[0] is '4' or '5').Select(r => (o.Name, Status: r.Key, Response: r.Value!)))
            .ToList();
        // The global rate limiter covers every route, so every operation documents its 429 (Addendum B §B2: a <response> for every
        // status the endpoint can return).
        Operations(document).Where(o => o.Operation["responses"]!["429"] is null).Select(o => o.Name)
            .ShouldBeEmpty("operations without a 429: declare .ProducesRateLimitedProblem() and a <response code=\"429\"> comment");
        errors.Select(e => (e.Name, e.Status)).ShouldBe(
            [
                ("GET /api/v1/dealerships", "429"),
                ("GET /api/v1/dealerships/{dealershipId}/service-types", "404"),
                ("GET /api/v1/dealerships/{dealershipId}/service-types", "429"),
                ("GET /api/v1/dealerships/{dealershipId}/availability", "400"),
                ("GET /api/v1/dealerships/{dealershipId}/availability", "404"),
                ("GET /api/v1/dealerships/{dealershipId}/availability", "429"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "400"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "404"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "409"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "422"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "429"),
                ("GET /api/v1/appointments/{appointmentId}", "404"),
                ("GET /api/v1/appointments/{appointmentId}", "429"),
                ("POST /api/v1/appointments/{appointmentId}/cancel", "400"),
                ("POST /api/v1/appointments/{appointmentId}/cancel", "404"),
                ("POST /api/v1/appointments/{appointmentId}/cancel", "409"),
                ("POST /api/v1/appointments/{appointmentId}/cancel", "429"),
                ("GET /api/v1/dealerships/{dealershipId}/schedule", "400"),
                ("GET /api/v1/dealerships/{dealershipId}/schedule", "404"),
                ("GET /api/v1/dealerships/{dealershipId}/schedule", "429"),
                ("GET /api/v1/booking-triage", "429"),
                ("POST /api/v1/dealerships/{dealershipId}/booking-triage", "400"),
                ("POST /api/v1/dealerships/{dealershipId}/booking-triage", "404"),
                ("POST /api/v1/dealerships/{dealershipId}/booking-triage", "429"),
                ("POST /api/v1/dealerships/{dealershipId}/booking-triage", "503"),
            ],
            ignoreOrder: true);

        foreach (var (name, status, response) in errors)
        {
            // RFC 9457: problems, and only problems, are application/problem+json. A 400 adds the field-keyed errors.
            var content = response["content"].ShouldNotBeNull($"{name} {status}").AsObject();
            content.Select(c => c.Key).ShouldBe(["application/problem+json"], $"{name} {status}");
            Text(content["application/problem+json"]!["schema"]!["$ref"])
                .ShouldBe(status == "400" ? "#/components/schemas/HttpValidationProblemDetails" : "#/components/schemas/ProblemDetails", $"{name} {status}");

            // A <response> comment describes it, not the reason phrase; a 429 says when to retry.
            Text(response["description"]).ShouldNotBe(ReasonPhrases.GetReasonPhrase(int.Parse(status, CultureInfo.InvariantCulture)), $"{name} {status}");
            if (status == "429")
            {
                var retryAfter = response["headers"]?["Retry-After"].ShouldNotBeNull($"{name} 429 Retry-After header");
                Text(retryAfter!["description"]).ShouldNotBeNullOrWhiteSpace($"{name} 429 Retry-After");
                Text(retryAfter["schema"]!["type"]).ShouldBe("integer", $"{name} 429 Retry-After");
            }
        }

        string[] rfc9457 = ["type", "title", "status", "detail", "instance"];
        foreach (var (schema, members) in new (string, string[])[]
                 {
                     ("ProblemDetails", [.. rfc9457, "traceId"]),
                     ("HttpValidationProblemDetails", [.. rfc9457, "errors", "traceId"]),
                 })
        {
            var problem = schemas[schema].ShouldNotBeNull(schema);
            var properties = problem["properties"]!.AsObject();
            properties.Select(p => p.Key).ShouldBe(members, ignoreOrder: true, customMessage: schema);

            // Every problem this API writes carries the W3C trace id of the request (SYSTEM_DESIGN §8.7, §12.2), so the client may rely on it.
            Text(properties["traceId"]!["type"]).ShouldBe("string", schema);
            Text(properties["traceId"]!["description"]).ShouldNotBeNullOrWhiteSpace(schema);
            Required(problem).ShouldContain("traceId", schema);
        }
    }

    [Fact]
    public async Task Request_bodies_are_described_by_their_own_parameter()
    {
        var document = await ServedAsync();

        // Microsoft.AspNetCore.OpenApi 10.0's XML-comment transformer copies every <param> that matches no operation parameter (the
        // body, injected services, the cancellation token) onto the request body, so the last such tag would describe it.
        var bodies = Operations(document).Where(o => o.Operation["requestBody"] is not null)
            .Select(o => (o.Operation["operationId"]!.GetValue<string>(), Text(o.Operation["requestBody"]!["description"])))
            .ToList();
        bodies.ShouldBe(
        [
            ("BookAppointment", "The booking: the service and its start time, the customer and the vehicle, with an optional preferred bay, technician and notes."),
            ("CancelAppointment", "The cancellation: why the appointment is cancelled."),
            ("TriageBookingRequest", "The booking intake: the customer's issue and optional preferred date, as untrusted text."),
        ]);
    }

    [Fact]
    public async Task Every_response_has_a_schema_and_every_reference_resolves()
    {
        var document = await ServedAsync();
        var schemas = document["components"]!["schemas"]!.AsObject();

        // The success bodies. A type missing from SchedulerJsonContext fails the document request itself (reflection-free JSON, ADR-016).
        var successes = Operations(document)
            .SelectMany(o => o.Operation["responses"]!.AsObject().Where(r => r.Key[0] == '2').Select(r => (o.Name, Status: r.Key, Schema: SuccessSchema(r.Value!))))
            .ToList();
        successes.ShouldBe(
            [
                ("GET /api/v1/dealerships", "200", "DealershipResponse[]"),
                ("GET /api/v1/dealerships/{dealershipId}/service-types", "200", "ServiceTypeResponse[]"),
                ("GET /api/v1/dealerships/{dealershipId}/availability", "200", "AvailabilityResponse"),
                ("POST /api/v1/dealerships/{dealershipId}/appointments", "201", "AppointmentResponse"),
                ("GET /api/v1/appointments/{appointmentId}", "200", "AppointmentResponse"),
                ("POST /api/v1/appointments/{appointmentId}/cancel", "200", "AppointmentResponse"),
                ("GET /api/v1/dealerships/{dealershipId}/schedule", "200", "WorkshopScheduleResponse"),
                ("GET /api/v1/booking-triage", "200", "BookingTriageStatusResponse"),
                ("POST /api/v1/dealerships/{dealershipId}/booking-triage", "200", "TriageBookingResponse"),
            ]);

        foreach (var (name, status, response) in Operations(document).SelectMany(o => o.Operation["responses"]!.AsObject().Select(r => (o.Name, r.Key, r.Value!))))
        {
            Text(response["description"]).ShouldNotBeNullOrWhiteSpace($"{name} {status}");
            response["content"].ShouldNotBeNull($"{name} {status} has no body schema").AsObject()
                .ShouldAllBe(media => media.Value!["schema"] != null, $"{name} {status}");
        }

        var references = Descendants(document).Where(n => n.Name == "$ref").Select(n => n.Node!.GetValue<string>()).Distinct().ToList();
        references.ShouldNotBeEmpty();
        references.Where(r => !r.StartsWith("#/components/schemas/", StringComparison.Ordinal) || schemas[r["#/components/schemas/".Length..]] is null)
            .ShouldBeEmpty("references that do not resolve to a component schema");
    }

    [Fact]
    public async Task Response_properties_are_all_required_and_nullable_exactly_where_the_api_writes_null()
    {
        var document = await ServedAsync();
        var schemas = document["components"]!["schemas"]!.AsObject();

        // The component schemas the success responses reach are exactly the response types listed above.
        var reached = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var operation in Operations(document))
        {
            foreach (var response in operation.Operation["responses"]!.AsObject().Where(r => r.Key[0] == '2'))
            {
                Reach(response.Value!["content"]!["application/json"]!["schema"]!, schemas, reached);
            }
        }

        var objectSchemas = reached.Where(name => schemas[name]!["properties"] is not null).ToList();
        objectSchemas.ShouldBe(ResponseTypes.Select(t => t.Type.Name), ignoreOrder: true, customMessage: "response object schemas");

        foreach (var typeInfo in ResponseTypes)
        {
            var name = typeInfo.Type.Name;
            var schema = schemas[name]!;
            var properties = schema["properties"]!.AsObject();
            properties.Select(p => p.Key).ShouldBe(typeInfo.Properties.Select(p => p.Name), name);

            // Required: HeyAPI types a property that is not required as optional (`id?: string`), which this API never omits.
            Required(schema).ShouldBe(typeInfo.Properties.Select(p => p.Name), ignoreOrder: true, customMessage: $"{name}.required");

            foreach (var property in typeInfo.Properties)
            {
                IsNullable(properties[property.Name]!).ShouldBe(property.IsGetNullable, $"{name}.{property.Name} nullable");
            }
        }
    }

    private async Task<JsonNode> ServedAsync() => JsonNode.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct))!;

    /// <summary>Each operation as <c>"METHOD /path"</c>, in document order.</summary>
    private static IEnumerable<(string Name, JsonObject Operation)> Operations(JsonNode document) =>
        document["paths"]!.AsObject().SelectMany(path => path.Value!.AsObject()
            .Where(member => member.Key is "get" or "put" or "post" or "delete" or "patch")
            .Select(member => ($"{member.Key.ToUpperInvariant()} {path.Key}", member.Value!.AsObject())));

    private static string SuccessSchema(JsonNode response)
    {
        var content = response["content"].ShouldNotBeNull().AsObject();
        content.Select(c => c.Key).ShouldBe(["application/json"]);
        var schema = content["application/json"]!["schema"]!;
        return schema["type"]?.GetValue<string>() == "array" ? ComponentName(schema["items"]!) + "[]" : ComponentName(schema);
    }

    private static string ComponentName(JsonNode schema) =>
        schema["$ref"].ShouldNotBeNull("an inline schema where a component reference was expected").GetValue<string>()["#/components/schemas/".Length..];

    /// <summary>A string member's value, or null when the member is absent (so the assertion on it runs, and fails, rather than being skipped).</summary>
    private static string? Text(JsonNode? node) => node?.GetValue<string>();

    private static List<string> Required(JsonNode schema) =>
        schema["required"]?.AsArray().Select(r => r!.GetValue<string>()).ToList() ?? [];

    /// <summary>OpenAPI 3.1 nullability: <c>type: [..., "null"]</c>, or a <c>oneOf</c> with a <c>null</c> branch for a nullable reference.</summary>
    private static bool IsNullable(JsonNode schema) =>
        (schema["type"] is JsonArray types && types.Any(t => t!.GetValue<string>() == "null"))
        || (schema["oneOf"] is JsonArray branches && branches.Any(b => b!["type"]?.GetValueKind() == JsonValueKind.String && b["type"]!.GetValue<string>() == "null"));

    /// <summary>Adds every component schema reachable from <paramref name="schema"/> to <paramref name="reached"/>.</summary>
    private static void Reach(JsonNode schema, JsonObject schemas, SortedSet<string> reached)
    {
        foreach (var (name, node) in Descendants(schema).Prepend((Name: "", Node: (JsonNode?)schema)))
        {
            if (name == "$ref" && node!.GetValue<string>() is var reference && reached.Add(reference["#/components/schemas/".Length..]))
            {
                Reach(schemas[reference["#/components/schemas/".Length..]]!, schemas, reached);
            }
        }
    }

    /// <summary>Every member of every object below <paramref name="node"/>, depth first.</summary>
    private static IEnumerable<(string Name, JsonNode? Node)> Descendants(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var (name, child) in obj)
                {
                    yield return (name, child);
                    foreach (var descendant in Descendants(child))
                    {
                        yield return descendant;
                    }
                }

                break;
            case JsonArray array:
                foreach (var descendant in array.SelectMany(Descendants))
                {
                    yield return descendant;
                }

                break;
        }
    }

    /// <summary>Where two documents differ, as JSON paths: values, members present on one side only, member order, array lengths.</summary>
    private static IEnumerable<string> Differences(JsonNode? committed, JsonNode? served, string path)
    {
        switch (committed, served)
        {
            case (JsonObject c, JsonObject s):
                var committedNames = c.Select(p => p.Key).ToList();
                var servedNames = s.Select(p => p.Key).ToList();
                foreach (var name in committedNames.Union(servedNames))
                {
                    var child = $"{path}.{name}";
                    if (!s.ContainsKey(name))
                    {
                        yield return $"{child}: only in the committed contract";
                    }
                    else if (!c.ContainsKey(name))
                    {
                        yield return $"{child}: only in the served document";
                    }
                    else
                    {
                        foreach (var difference in Differences(c[name], s[name], child))
                        {
                            yield return difference;
                        }
                    }
                }

                if (!committedNames.Intersect(servedNames).SequenceEqual(servedNames.Intersect(committedNames)))
                {
                    yield return $"{path}: members in a different order";
                }

                break;
            case (JsonArray c, JsonArray s):
                if (c.Count != s.Count)
                {
                    yield return $"{path}: {c.Count} items committed, {s.Count} served";
                }

                for (var i = 0; i < Math.Min(c.Count, s.Count); i++)
                {
                    foreach (var difference in Differences(c[i], s[i], $"{path}[{i}]"))
                    {
                        yield return difference;
                    }
                }

                break;
            default:
                if (!JsonNode.DeepEquals(committed, served))
                {
                    yield return $"{path}: committed {committed?.ToJsonString(Canonical) ?? "null"}, served {served?.ToJsonString(Canonical) ?? "null"}";
                }

                break;
        }
    }

    private static string LocateContract()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Keyloop.ServiceScheduler.sln")))
            {
                return Path.Combine(directory.FullName, "contracts", "openapi", "v1.json");
            }
        }

        throw new InvalidOperationException($"No Keyloop.ServiceScheduler.sln above {AppContext.BaseDirectory}.");
    }
}

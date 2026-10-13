using System.Net;
using System.Text.Json.Nodes;
using System.Text.Json;
using System.Text;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Runtime OpenAPI document and Scalar reference tests.</summary>
public sealed class OpenApiDocumentTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

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
    public async Task Document_has_fixed_info_and_tags_no_servers_and_no_test_endpoints()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;

        root.GetProperty("openapi").GetString().ShouldNotBeNull().ShouldStartWith("3.1");
        var info = root.GetProperty("info");
        info.GetProperty("title").GetString().ShouldBe("Keyloop Unified Service Scheduler API");
        info.GetProperty("version").GetString().ShouldBe("v1");
        var description = info.GetProperty("description").GetString().ShouldNotBeNull();
        foreach (var fragment in new[] { "400", "422", "409", "application/problem+json", "https://api.keyloop.example/problems/" })
        {
            description.ShouldContain(fragment);
        }

        var tags = root.GetProperty("tags").EnumerateArray().ToList();
        tags.Select(tag => tag.GetProperty("name").GetString()).ShouldBe(["Dealerships", "Catalog", "Availability", "Appointments", "Identity", "Schedule", "Features", "Admin"]);
        tags.ShouldAllBe(tag => !string.IsNullOrWhiteSpace(tag.GetProperty("description").GetString()));

        (root.TryGetProperty("servers", out var servers) && servers.GetArrayLength() > 0).ShouldBeFalse();

        var paths = root.TryGetProperty("paths", out var p) ? p.EnumerateObject().Select(path => path.Name).ToList() : [];
        paths.ShouldNotContain(path => path.Contains("__throw", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Catalogue_operations_carry_ids_tags_xml_docs_and_response_schemas()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;
        var paths = root.GetProperty("paths");

        var dealerships = paths.GetProperty("/api/v1/dealerships").GetProperty("get");
        ShouldBeDocumented(dealerships, "GetDealerships", "Dealerships");
        ItemsRef(dealerships, "200", "application/json").ShouldBe("#/components/schemas/DealershipResponse");

        var serviceTypes = paths.GetProperty("/api/v1/dealerships/{dealershipId}/service-types").GetProperty("get");
        ShouldBeDocumented(serviceTypes, "GetServiceTypes", "Catalog");
        ItemsRef(serviceTypes, "200", "application/json").ShouldBe("#/components/schemas/ServiceTypeResponse");
        var parameter = serviceTypes.GetProperty("parameters").EnumerateArray().Where(p => p.GetProperty("in").GetString() == "path").ShouldHaveSingleItem();
        parameter.GetProperty("name").GetString().ShouldBe("dealershipId");
        parameter.GetProperty("in").GetString().ShouldBe("path");
        parameter.GetProperty("schema").GetProperty("format").GetString().ShouldBe("uuid");
        parameter.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace();
        var notFound = serviceTypes.GetProperty("responses").GetProperty("404");
        notFound.GetProperty("description").GetString().ShouldNotBe("Not Found", "the <response> comment, not the default reason phrase");
        notFound.GetProperty("content").GetProperty("application/problem+json").GetProperty("schema").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/ProblemDetails");

        var schemas = root.GetProperty("components").GetProperty("schemas");
        foreach (var (schema, properties) in new (string, string[])[]
                 {
                     ("DealershipResponse", ["id", "name", "timeZoneId", "operatingHours"]),
                     ("DayOperatingHoursResponse", ["day", "opensAt", "closesAt"]),
                     ("ServiceTypeResponse", ["id", "code", "name", "durationMinutes", "requiredBayCapabilities", "requiredCertifications", "bookable"]),
                 })
        {
            var described = schemas.GetProperty(schema).GetProperty("properties").EnumerateObject()
                .Select(p => (p.Name, Described: p.Value.TryGetProperty("description", out var d) && !string.IsNullOrWhiteSpace(d.GetString())))
                .ToList();
            described.Select(p => p.Name).ShouldBe(properties, schema);
            described.Where(p => !p.Described).Select(p => p.Name).ShouldBeEmpty($"{schema} properties without a description");
        }

        var duration = schemas.GetProperty("ServiceTypeResponse").GetProperty("properties").GetProperty("durationMinutes");
        duration.GetProperty("type").GetString().ShouldBe("integer");
        duration.TryGetProperty("pattern", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task Availability_operation_documents_typed_required_parameters_with_seeded_examples()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;
        var availability = root.GetProperty("paths").GetProperty("/api/v1/dealerships/{dealershipId}/availability").GetProperty("get");

        ShouldBeDocumented(availability, "GetAvailability", "Availability");
        var responses = availability.GetProperty("responses");
        responses.GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/AvailabilityResponse");
        foreach (var (status, schema, reasonPhrase) in new[] { ("400", "HttpValidationProblemDetails", "Bad Request"), ("404", "ProblemDetails", "Not Found") })
        {
            var response = responses.GetProperty(status);
            response.GetProperty("description").GetString().ShouldNotBe(reasonPhrase, $"the <response code=\"{status}\"> comment");
            response.GetProperty("content").GetProperty("application/problem+json").GetProperty("schema").GetProperty("$ref").GetString()
                .ShouldBe($"#/components/schemas/{schema}");
        }

        var parameters = availability.GetProperty("parameters").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        parameters.Keys.ShouldBe(["dealershipId", "serviceTypeId", "date", "powertrain", "manufacturer", "vehicleClass", "needsLiveDiagnosis", "X-Request-Id"], ignoreOrder: true);
        foreach (var (name, location, format, example) in new[]
                 {
                     ("dealershipId", "path", "uuid", ReferenceDataSeed.ReadingDealershipId.ToString()),
                     ("serviceTypeId", "query", "uuid", ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE").ToString()),
                     ("date", "query", "date", "2026-10-13"),
                 })
        {
            var parameter = parameters[name];
            parameter.GetProperty("in").GetString().ShouldBe(location, name);
            parameter.GetProperty("required").GetBoolean().ShouldBeTrue(name);
            parameter.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace(name);
            parameter.GetProperty("example").GetString().ShouldBe(example, name);
            var schema = parameter.GetProperty("schema");
            schema.GetProperty("type").GetString().ShouldBe("string", name);
            schema.GetProperty("format").GetString().ShouldBe(format, name);
        }

        foreach (var (name, values) in new (string, string[])[]
                 {
                     ("powertrain", ["Ice", "MildHybrid", "FullHybrid", "PluginHybrid", "BatteryElectric", "FuelCell", "Unknown"]),
                     ("vehicleClass", ["Car", "LightCommercial", "Heavy", "Unknown"]),
                 })
        {
            var schema = parameters[name].GetProperty("schema");
            schema.GetProperty("type").GetString().ShouldBe("string", name);
            schema.GetProperty("enum").EnumerateArray().Select(v => v.GetString()).ShouldBe(values, name);
        }

        parameters["needsLiveDiagnosis"].GetProperty("schema").GetProperty("type").GetString().ShouldBe("boolean");

        var schemas = root.GetProperty("components").GetProperty("schemas");
        foreach (var (schema, properties) in new (string, string[])[]
                 {
                     ("AvailabilityResponse", ["date", "timeZoneId", "operatingWindow", "durationMinutes", "slotGranularityMinutes", "slots", "unavailableReason"]),
                     ("OperatingWindowResponse", ["startUtc", "endUtc", "opensAtLocal", "closesAtLocal"]),
                     ("AvailabilitySlotResponse", ["startUtc", "endUtc", "startLocal", "freeBays", "freeTechnicians"]),
                 })
        {
            var described = schemas.GetProperty(schema).GetProperty("properties").EnumerateObject()
                .Select(p => (p.Name, Described: HasDescription(p.Value)
                    || (p.Value.TryGetProperty("oneOf", out var branches) && branches.EnumerateArray().Any(HasDescription))))
                .ToList();
            described.Select(p => p.Name).ShouldBe(properties, schema);
            described.Where(p => !p.Described).Select(p => p.Name).ShouldBeEmpty($"{schema} properties without a description");
        }

        static bool HasDescription(JsonElement schema) =>
            schema.TryGetProperty("description", out var description) && !string.IsNullOrWhiteSpace(description.GetString());
    }

    [Fact]
    public async Task Booking_operation_documents_responses_headers_and_an_example_body_that_books()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;
        var booking = root.GetProperty("paths").GetProperty("/api/v1/dealerships/{dealershipId}/appointments").GetProperty("post");

        booking.GetProperty("operationId").GetString().ShouldBe("BookAppointment");
        booking.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ShouldBe(["Appointments"]);
        booking.GetProperty("summary").GetString().ShouldNotBeNullOrWhiteSpace();
        booking.GetProperty("description").GetString().ShouldNotBeNull().ShouldContain("Idempotency-Key");

        var responses = booking.GetProperty("responses");
        responses.EnumerateObject().Select(r => r.Name).ShouldBe(["201", "400", "401", "403", "404", "409", "413", "422", "429"], ignoreOrder: true);
        foreach (var (status, mediaType, schema, reasonPhrase) in new[]
                 {
                     ("201", "application/json", "AppointmentResponse", "Created"),
                     ("400", "application/problem+json", "HttpValidationProblemDetails", "Bad Request"),
                     ("404", "application/problem+json", "ProblemDetails", "Not Found"),
                     ("409", "application/problem+json", "ProblemDetails", "Conflict"),
                     ("422", "application/problem+json", "ProblemDetails", "Unprocessable Entity"),
                     ("429", "application/problem+json", "ProblemDetails", "Too Many Requests"),
                 })
        {
            var response = responses.GetProperty(status);
            response.GetProperty("description").GetString().ShouldNotBe(reasonPhrase, $"the <response code=\"{status}\"> comment");
            response.GetProperty("content").GetProperty(mediaType).GetProperty("schema").GetProperty("$ref").GetString()
                .ShouldBe($"#/components/schemas/{schema}", status);
        }

        var created = responses.GetProperty("201").GetProperty("headers");
        created.EnumerateObject().Select(h => h.Name).ShouldBe(["Location", "Idempotent-Replayed", "X-Request-Id"], ignoreOrder: true);
        created.EnumerateObject().ShouldAllBe(h => !string.IsNullOrWhiteSpace(h.Value.GetProperty("description").GetString()));

        var parameters = booking.GetProperty("parameters").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        parameters.Keys.ShouldBe(["dealershipId", "Idempotency-Key", "X-Request-Id"], ignoreOrder: true);
        parameters["dealershipId"].GetProperty("example").GetString().ShouldBe(ReferenceDataSeed.ReadingDealershipId.ToString());
        var key = parameters["Idempotency-Key"];
        key.GetProperty("in").GetString().ShouldBe("header");
        (key.TryGetProperty("required", out var required) && required.GetBoolean()).ShouldBeFalse();
        key.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace();
        var keySchema = key.GetProperty("schema");
        keySchema.GetProperty("maxLength").GetInt32().ShouldBe(64);
        keySchema.GetProperty("pattern").GetString().ShouldBe("^[A-Za-z0-9_-]{1,64}$");

        var body = booking.GetProperty("requestBody");
        body.GetProperty("required").GetBoolean().ShouldBeTrue();
        body.GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/BookAppointmentRequest");

        var schemas = root.GetProperty("components").GetProperty("schemas");
        foreach (var (schema, properties) in new (string, string[])[]
                 {
                     ("BookAppointmentRequest", ["needsLiveDiagnosis", "serviceTypeId", "startUtc", "customer", "vehicle", "preferredBayId", "preferredTechnicianId", "notes"]),
                     ("CustomerRequest", ["name", "email", "phone"]),
                     ("VehicleRequest", ["profile", "vin", "registration", "make", "model"]),
                 })
        {
            var props = schemas.GetProperty(schema).GetProperty("properties").EnumerateObject().ToList();
            props.Select(p => p.Name).ShouldBe(properties, schema);
            props.Where(p => !Describes(p.Value, "description")).Select(p => p.Name).ShouldBeEmpty($"{schema} properties without a description");
            props.Where(p => !p.Value.TryGetProperty("$ref", out _) && Example(p.Value) is null && (schema, p.Name) != ("VehicleRequest", "profile"))
                .Select(p => p.Name).ShouldBeEmpty($"{schema} properties without an example");
        }

        foreach (var (schema, properties) in new (string, string[])[]
                 {
                     ("AppointmentResponse",
                     [
                         "id", "dealershipId", "serviceType", "bay", "technician", "startUtc", "endUtc", "startLocal", "endLocal", "status", "customer",
                         "vehicle", "notes", "cancellationReason", "createdAtUtc", "updatedAtUtc", "allocation", "competenceWarning",
                     ]),
                     ("ServiceTypeSummary", ["id", "code", "name", "durationMinutes"]),
                     ("ResourceSummary", ["id", "name"]),
                     ("CustomerResponse", ["name", "email", "phone"]),
                     ("VehicleResponse", ["vin", "registration", "make", "model", "profile"]),
                 })
        {
            var props = schemas.GetProperty(schema).GetProperty("properties").EnumerateObject().ToList();
            props.Select(p => p.Name).ShouldBe(properties, schema);
            props.Where(p => !Describes(p.Value, "description")).Select(p => p.Name).ShouldBeEmpty($"{schema} properties without a description");
        }

        schemas.GetProperty("BookAppointmentRequest").GetProperty("required").EnumerateArray().Select(r => r.GetString())
            .ShouldBe(["serviceTypeId", "startUtc", "customer", "vehicle"], ignoreOrder: true);

        var example = ExampleOf(schemas, "BookAppointmentRequest");
        example["serviceTypeId"]!.GetValue<string>().ShouldBe(ReferenceDataSeed.ServiceTypeId("INTERIM-SERVICE").ToString());
        example["startUtc"]!.GetValue<string>().ShouldBe("2026-10-13T09:00:00Z");
        example["preferredBayId"]!.GetValue<string>().ShouldBe(ReferenceDataSeed.BayId("reading", 1).ToString());
        example["preferredTechnicianId"]!.GetValue<string>().ShouldBe(ReferenceDataSeed.TechnicianId("T-1001").ToString());
        example["vehicle"]!["vin"]!.GetValue<string>().ShouldBe("WVWZZZ1KZAW123456");
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));

        using var booked = await _client.PostAsync(
            $"/api/v1/dealerships/{ReferenceDataSeed.ReadingDealershipId}/appointments",
            new StringContent(example.ToJsonString(), Encoding.UTF8, "application/json"),
            Ct);

        booked.StatusCode.ShouldBe(HttpStatusCode.Created, await booked.Content.ReadAsStringAsync(Ct));
        await _factory.ResetAsync();

        static bool Describes(JsonElement schema, string keyword) =>
            (schema.TryGetProperty(keyword, out var value) && value.ValueKind != JsonValueKind.Null && value.ToString().Length > 0)
            || (schema.TryGetProperty("oneOf", out var branches) && branches.EnumerateArray().Any(b => Describes(b, keyword)));
    }

    [Fact]
    public async Task Appointment_read_and_cancel_operations_are_documented_with_an_example_reason()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;
        var paths = root.GetProperty("paths");

        var read = paths.GetProperty("/api/v1/appointments/{appointmentId}").GetProperty("get");
        ShouldBeDocumented(read, "GetAppointment", "Appointments");
        var cancel = paths.GetProperty("/api/v1/appointments/{appointmentId}/cancel").GetProperty("post");
        ShouldBeDocumented(cancel, "CancelAppointment", "Appointments");
        cancel.GetProperty("description").GetString().ShouldNotBeNull().ShouldContain("re-bookable");

        foreach (var (operation, statuses) in new[] { (read, new[] { "200", "401", "403", "404", "429" }), (cancel, ["200", "400", "401", "403", "404", "409", "429"]) })
        {
            var operationId = operation.GetProperty("operationId").GetString();
            var responses = operation.GetProperty("responses");
            responses.EnumerateObject().Select(r => r.Name).ShouldBe(statuses, ignoreOrder: true, customMessage: operationId);
            responses.GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()
                .ShouldBe("#/components/schemas/AppointmentResponse", operationId);

            var parameter = operation.GetProperty("parameters").EnumerateArray().Where(p => p.GetProperty("in").GetString() == "path").ShouldHaveSingleItem(operationId);
            (parameter.GetProperty("name").GetString(), parameter.GetProperty("in").GetString()).ShouldBe(("appointmentId", "path"), operationId);
            parameter.GetProperty("required").GetBoolean().ShouldBeTrue(operationId);
            parameter.GetProperty("schema").GetProperty("format").GetString().ShouldBe("uuid", operationId);
            parameter.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace(operationId);
        }

        var conflict = cancel.GetProperty("responses").GetProperty("409").GetProperty("description").GetString().ShouldNotBeNull();
        conflict.ShouldContain("invalid-state-transition");
        conflict.ShouldContain("concurrency-conflict");

        var body = cancel.GetProperty("requestBody");
        body.GetProperty("required").GetBoolean().ShouldBeTrue();
        body.GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/CancelAppointmentRequest");
        var request = root.GetProperty("components").GetProperty("schemas").GetProperty("CancelAppointmentRequest");
        request.GetProperty("required").EnumerateArray().Select(r => r.GetString()).ShouldBe(["reason"]);
        var reason = request.GetProperty("properties").EnumerateObject().ShouldHaveSingleItem();
        reason.Name.ShouldBe("reason");
        reason.Value.GetProperty("type").GetString().ShouldBe("string");
        reason.Value.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace();
        Example(reason.Value).ShouldNotBeNull("an <example> on the property").GetValue<string>().ShouldBe("Customer called to reschedule.");
    }

    [Fact]
    public async Task Schedule_operation_documents_its_parameters_and_a_described_board()
    {
        using var document = JsonDocument.Parse(await _client.GetStringAsync("/openapi/v1.json", Ct));
        var root = document.RootElement;
        var schedule = root.GetProperty("paths").GetProperty("/api/v1/dealerships/{dealershipId}/schedule").GetProperty("get");

        ShouldBeDocumented(schedule, "GetWorkshopSchedule", "Schedule");
        var responses = schedule.GetProperty("responses");
        responses.EnumerateObject().Select(r => r.Name).ShouldBe(["200", "400", "404", "429"], ignoreOrder: true);
        foreach (var (status, mediaType, schema, reasonPhrase) in new[]
                 {
                     ("200", "application/json", "WorkshopScheduleResponse", "OK"),
                     ("400", "application/problem+json", "HttpValidationProblemDetails", "Bad Request"),
                     ("404", "application/problem+json", "ProblemDetails", "Not Found"),
                 })
        {
            var response = responses.GetProperty(status);
            response.GetProperty("description").GetString().ShouldNotBe(reasonPhrase, $"the <response code=\"{status}\"> comment");
            response.GetProperty("content").GetProperty(mediaType).GetProperty("schema").GetProperty("$ref").GetString()
                .ShouldBe($"#/components/schemas/{schema}", status);
        }

        var parameters = schedule.GetProperty("parameters").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        parameters.Keys.ShouldBe(["dealershipId", "date", "X-Request-Id"], ignoreOrder: true);
        foreach (var (name, location, format, example) in new[]
                 {
                     ("dealershipId", "path", "uuid", ReferenceDataSeed.ReadingDealershipId.ToString()),
                     ("date", "query", "date", "2026-10-13"),
                 })
        {
            var parameter = parameters[name];
            parameter.GetProperty("in").GetString().ShouldBe(location, name);
            parameter.GetProperty("required").GetBoolean().ShouldBeTrue(name);
            parameter.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace(name);
            parameter.GetProperty("example").GetString().ShouldBe(example, name);
            var parameterSchema = parameter.GetProperty("schema");
            parameterSchema.GetProperty("type").GetString().ShouldBe("string", name);
            parameterSchema.GetProperty("format").GetString().ShouldBe(format, name);
        }

        var schemas = root.GetProperty("components").GetProperty("schemas");
        foreach (var (schema, properties) in new (string, string[])[]
                 {
                     ("WorkshopScheduleResponse", ["dealership", "date", "operatingWindow", "slotGranularityMinutes", "bays", "technicians"]),
                     ("DealershipSummary", ["id", "name", "timeZoneId"]),
                     ("BayScheduleResponse", ["id", "name", "capabilities", "isActive", "appointments"]),
                     ("TechnicianResponse", ["id", "name", "employeeNumber", "certifications", "isActive", "hvLevel", "hvLevelValidUntil", "hvLevelConfirmed", "brandSpecialisms"]),
                     ("ScheduledAppointmentResponse",
                     [
                         "id", "startUtc", "endUtc", "startLocal", "endLocal", "status", "serviceType", "technician", "vin", "registration", "customerName", "competenceWarning",
                     ]),
                 })
        {
            var described = schemas.GetProperty(schema).GetProperty("properties").EnumerateObject()
                .Select(p => (p.Name, Described: HasDescription(p.Value)
                    || (p.Value.TryGetProperty("oneOf", out var branches) && branches.EnumerateArray().Any(HasDescription))))
                .ToList();
            described.Select(p => p.Name).ShouldBe(properties, schema);
            described.Where(p => !p.Described).Select(p => p.Name).ShouldBeEmpty($"{schema} properties without a description");
        }

        var board = schemas.GetProperty("WorkshopScheduleResponse").GetProperty("properties");
        board.GetProperty("date").GetProperty("type").GetString().ShouldBe("string");
        board.GetProperty("date").GetProperty("format").GetString().ShouldBe("date");
        board.GetProperty("bays").GetProperty("items").GetProperty("$ref").GetString().ShouldBe("#/components/schemas/BayScheduleResponse");
        board.GetProperty("technicians").GetProperty("items").GetProperty("$ref").GetString().ShouldBe("#/components/schemas/TechnicianResponse");
        schemas.GetProperty("BayScheduleResponse").GetProperty("properties").GetProperty("appointments").GetProperty("items").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/ScheduledAppointmentResponse");

        static bool HasDescription(JsonElement schema) =>
            schema.TryGetProperty("description", out var description) && !string.IsNullOrWhiteSpace(description.GetString());
    }

    private static JsonNode? Example(JsonElement schema) =>
        schema.TryGetProperty("examples", out var examples) && examples.ValueKind == JsonValueKind.Array && examples.GetArrayLength() > 0
            ? JsonNode.Parse(examples[0].GetRawText())
            : schema.TryGetProperty("example", out var example) ? JsonNode.Parse(example.GetRawText())
                : schema.TryGetProperty("oneOf", out var branches) ? branches.EnumerateArray().Select(Example).FirstOrDefault(e => e is not null) : null;

    private static JsonObject ExampleOf(JsonElement schemas, string schema)
    {
        var example = new JsonObject();
        foreach (var property in schemas.GetProperty(schema).GetProperty("properties").EnumerateObject())
        {
            var reference = property.Value.TryGetProperty("$ref", out var r) ? r.GetString() : null;
            example[property.Name] = reference is not null
                ? ExampleOf(schemas, reference["#/components/schemas/".Length..])
                : Example(property.Value) ?? (FirstBranchIsNull(property.Value) ? null : throw new ShouldAssertException($"{schema}.{property.Name} has no example"));
        }

        return example;
    }

    private static bool FirstBranchIsNull(JsonElement schema) =>
        schema.TryGetProperty("oneOf", out var branches) && branches.GetArrayLength() > 0
        && branches[0].TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "null";

    private static void ShouldBeDocumented(JsonElement operation, string operationId, string tag)
    {
        operation.GetProperty("operationId").GetString().ShouldBe(operationId);
        operation.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ShouldBe([tag]);
        operation.GetProperty("summary").GetString().ShouldNotBeNullOrWhiteSpace(operationId);
        operation.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace(operationId);
        operation.GetProperty("responses").GetProperty("200").GetProperty("description").GetString().ShouldNotBe("OK", operationId);
    }

    private static string? ItemsRef(JsonElement operation, string status, string mediaType)
    {
        var schema = operation.GetProperty("responses").GetProperty(status).GetProperty("content").GetProperty(mediaType).GetProperty("schema");
        schema.GetProperty("type").GetString().ShouldBe("array");
        return schema.GetProperty("items").GetProperty("$ref").GetString();
    }

    [Fact]
    public async Task Scalar_reference_is_served_at_scalar_v1()
    {
        using var response = await _client.GetAsync("/scalar/v1", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("text/html");
        var html = await response.Content.ReadAsStringAsync(Ct);
        html.ShouldContain("Keyloop Service Scheduler API");
    }
}

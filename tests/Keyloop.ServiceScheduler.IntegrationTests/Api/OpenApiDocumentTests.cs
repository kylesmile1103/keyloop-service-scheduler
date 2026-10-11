using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>The runtime OpenAPI document's fixed parts (Addendum B §B1–B2) and the Scalar reference (§B3).</summary>
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
        tags.Select(tag => tag.GetProperty("name").GetString()).ShouldBe(["Dealerships", "Catalog", "Availability", "Appointments", "Schedule"]);
        tags.ShouldAllBe(tag => !string.IsNullOrWhiteSpace(tag.GetProperty("description").GetString()));

        // Scalar then targets the current origin, and the build-time document cannot differ by host.
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
        var parameter = serviceTypes.GetProperty("parameters").EnumerateArray().ShouldHaveSingleItem(); // services and the token are not parameters
        parameter.GetProperty("name").GetString().ShouldBe("dealershipId");
        parameter.GetProperty("in").GetString().ShouldBe("path");
        parameter.GetProperty("schema").GetProperty("format").GetString().ShouldBe("uuid");
        parameter.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace();
        var notFound = serviceTypes.GetProperty("responses").GetProperty("404");
        notFound.GetProperty("description").GetString().ShouldNotBe("Not Found", "the <response> comment, not the default reason phrase");
        notFound.GetProperty("content").GetProperty("application/problem+json").GetProperty("schema").GetProperty("$ref").GetString()
            .ShouldBe("#/components/schemas/ProblemDetails");

        // Every response property is described by its XML comment (Addendum B §B2).
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

        // Numbers are numbers on the wire, so the generated client types them as number, not number | string.
        var duration = schemas.GetProperty("ServiceTypeResponse").GetProperty("properties").GetProperty("durationMinutes");
        duration.GetProperty("type").GetString().ShouldBe("integer");
        duration.TryGetProperty("pattern", out _).ShouldBeFalse();
    }

    private static void ShouldBeDocumented(JsonElement operation, string operationId, string tag)
    {
        operation.GetProperty("operationId").GetString().ShouldBe(operationId);
        operation.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ShouldBe([tag]);
        operation.GetProperty("summary").GetString().ShouldNotBeNullOrWhiteSpace(operationId); // <summary>
        operation.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace(operationId); // <remarks>
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
        response.Content.Headers.ContentType?.MediaType.ShouldBe("text/html");
        var html = await response.Content.ReadAsStringAsync(Ct);
        html.ShouldContain("Keyloop Service Scheduler API");
    }
}

using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// RFC 9457 responses over HTTP, written with reflection-free JSON (this test process runs with
/// <c>JsonSerializerIsReflectionEnabledByDefault=false</c>, as the API does). The SystemTest-only <c>/api/v1/__throw?kind=…</c>
/// endpoint throws each exception <c>GlobalExceptionHandler</c> maps, so every problem-extension shape is serialised for real.
/// </summary>
public sealed partial class ProblemDetailsTests(PostgresFixture pg) : IAsyncLifetime
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
    public async Task Unknown_route_returns_404_problem_with_traceId()
    {
        using var response = await _client.GetAsync("/api/v1/no-such-route", Ct);

        var problem = await ReadProblemAsync(response, HttpStatusCode.NotFound);
        problem.GetProperty("title").GetString().ShouldBe("Not Found");
        problem.GetProperty("instance").GetString().ShouldBe("/api/v1/no-such-route");
        problem.GetProperty("traceId").GetString().ShouldNotBeNull().ShouldMatch(W3CTraceParent().ToString());
    }

    [Fact]
    public async Task Unhandled_exception_returns_500_problem_without_details()
    {
        using var response = await _client.GetAsync("/api/v1/__throw?kind=unhandled", Ct);

        var body = await response.Content.ReadAsStringAsync(Ct);
        var problem = await ReadProblemAsync(response, HttpStatusCode.InternalServerError, "internal-error");
        problem.GetProperty("title").GetString().ShouldBe("Internal server error");
        problem.GetProperty("detail").GetString().ShouldBe("An unexpected error occurred.");
        problem.EnumerateObject().Select(p => p.Name).ShouldBe(["type", "title", "status", "detail", "instance", "traceId"], ignoreOrder: true);
        body.ShouldNotContain("do-not-leak");
        body.ShouldNotContain("InvalidOperationException");
        body.ShouldNotContain("Keyloop.ServiceScheduler.Api");
    }

    [Fact]
    public async Task Security_headers_present_on_api_responses()
    {
        foreach (var (path, status) in new[] { ("/api/v1/__throw?kind=ok", 204), ("/api/v1/__throw?kind=unhandled", 500), ("/api/v1/no-such-route", 404) })
        {
            using var response = await _client.GetAsync(path, Ct);

            ((int)response.StatusCode).ShouldBe(status, path);
            Header(response, "X-Content-Type-Options").ShouldBe("nosniff", path);
            Header(response, "Referrer-Policy").ShouldBe("no-referrer", path);
            Header(response, "Permissions-Policy").ShouldBe("camera=(), microphone=(), geolocation=()", path);
            Header(response, "X-Frame-Options").ShouldBe("DENY", path);
            (response.Headers.CacheControl?.NoStore ?? false).ShouldBeTrue(path);
        }

        using var alive = await _client.GetAsync("/alive", Ct);
        Header(alive, "X-Content-Type-Options").ShouldBe("nosniff"); // every response, not only /api
    }

    [Fact]
    public async Task Enums_serialise_as_strings()
    {
        // Runtime JSON: an enum-valued problem extension.
        var transition = await ProblemAsync("transition", HttpStatusCode.Conflict, "invalid-state-transition");
        transition.GetProperty("currentStatus").GetString().ShouldBe("Cancelled");

        // OpenAPI: the schema generator uses the same JSON options. No endpoint exposes AppointmentStatus before the appointment
        // slices (Tasks 10-11), so a test-only document transformer asks the generator for its schema.
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.Configure<OpenApiOptions>("v1", options => options.AddDocumentTransformer(async (document, context, ct) =>
            {
                var schema = await context.GetOrCreateSchemaAsync(typeof(AppointmentStatus), null, ct);
                document.Components ??= new OpenApiComponents();
                document.Components.Schemas ??= new Dictionary<string, IOpenApiSchema>();
                document.Components.Schemas["AppointmentStatusProbe"] = schema;
            }))));
        using var client = factory.CreateClient();

        using var openApi = JsonDocument.Parse(await client.GetStringAsync("/openapi/v1.json", Ct));
        var status = openApi.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("AppointmentStatusProbe");
        status.GetProperty("enum").EnumerateArray().Select(value => value.GetString())
            .ShouldBe(["Confirmed", "CheckedIn", "InProgress", "Completed", "Cancelled", "NoShow"]);
    }

    [Fact]
    public async Task Rule_violation_extension_is_a_named_operating_window()
    {
        var problem = await ProblemAsync("rule", HttpStatusCode.UnprocessableEntity, "outside-operating-hours");

        problem.GetProperty("title").GetString().ShouldBe("Outside operating hours");
        problem.GetProperty("operatingWindow").GetRawText().ShouldBe("""{"startUtc":"2026-10-13T07:00:00Z","endUtc":"2026-10-13T17:00:00Z"}""");
    }

    [Fact]
    public async Task Instant_and_number_extensions_serialise()
    {
        (await ProblemAsync("lead-time", HttpStatusCode.UnprocessableEntity, "lead-time-not-met"))
            .GetProperty("earliestStartUtc").GetString().ShouldBe("2026-10-12T09:00:00Z");
        (await ProblemAsync("aligned", HttpStatusCode.UnprocessableEntity, "slot-not-aligned"))
            .GetProperty("slotGranularityMinutes").GetInt32().ShouldBe(15);
    }

    [Fact]
    public async Task Missing_capability_and_certification_lists_serialise_as_enum_names()
    {
        var problem = await ProblemAsync("qualified", HttpStatusCode.UnprocessableEntity, "no-qualified-resources");

        problem.GetProperty("missingCapabilities").GetRawText().ShouldBe("""["EvHighVoltage"]""");
        problem.GetProperty("missingCertifications").GetRawText().ShouldBe("""["HighVoltageElectrical"]""");
    }

    [Fact]
    public async Task Slot_unavailable_carries_suggested_slots()
    {
        var problem = await ProblemAsync("unavailable", HttpStatusCode.Conflict, "slot-unavailable");

        problem.GetProperty("suggestedSlots").GetRawText().ShouldBe(
            """[{"startUtc":"2026-10-13T09:00:00Z","endUtc":"2026-10-13T10:00:00Z","startLocal":"2026-10-13T10:00:00+01:00"},""" +
            """{"startUtc":"2026-10-13T10:00:00Z","endUtc":"2026-10-13T11:00:00Z","startLocal":"2026-10-13T11:00:00+01:00"}]""");
    }

    [Fact]
    public async Task Slot_conflict_carries_suggestions_and_the_conflicting_resource()
    {
        var problem = await ProblemAsync("conflict", HttpStatusCode.Conflict, "slot-conflict");

        problem.GetProperty("conflictingResource").GetString().ShouldBe("technician");
        problem.GetProperty("suggestedSlots").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Invalid_transition_carries_status_and_attempted_token()
    {
        var problem = await ProblemAsync("transition", HttpStatusCode.Conflict, "invalid-state-transition");

        problem.GetProperty("detail").GetString().ShouldBe("Cannot cancel this appointment while it is Cancelled.");
        problem.GetProperty("attempted").GetString().ShouldBe("cancel");
    }

    [Fact]
    public async Task Not_found_carries_resource_and_id()
    {
        var problem = await ProblemAsync("not-found", HttpStatusCode.NotFound, "not-found");

        problem.GetProperty("resource").GetString().ShouldBe("Appointment");
        problem.GetProperty("id").GetGuid().ShouldBe(Guid.Parse("0199d2a4-0000-7000-8000-000000000001"));
    }

    [Fact]
    public async Task Idempotency_and_concurrency_problems_have_no_extensions()
    {
        foreach (var (kind, status, slug) in new[]
                 {
                     ("idempotency", HttpStatusCode.UnprocessableEntity, "idempotency-key-reuse"),
                     ("concurrency", HttpStatusCode.Conflict, "concurrency-conflict"),
                 })
        {
            var problem = await ProblemAsync(kind, status, slug);
            problem.EnumerateObject().Select(p => p.Name).ShouldBe(["type", "title", "status", "detail", "instance", "traceId"], ignoreOrder: true);
        }
    }

    [Fact]
    public async Task Unreadable_request_is_400_validation_error()
    {
        using var response = await _client.GetAsync("/api/v1/__throw", Ct); // the required 'kind' query parameter is missing

        var problem = await ReadProblemAsync(response, HttpStatusCode.BadRequest, "validation-error");
        problem.GetProperty("title").GetString().ShouldBe("Validation failed");
    }

    private async Task<JsonElement> ProblemAsync(string kind, HttpStatusCode status, string slug)
    {
        using var response = await _client.GetAsync($"/api/v1/__throw?kind={kind}", Ct);
        return await ReadProblemAsync(response, status, slug);
    }

    private static async Task<JsonElement> ReadProblemAsync(HttpResponseMessage response, HttpStatusCode status, string? slug = null)
    {
        response.StatusCode.ShouldBe(status);
        response.Content.Headers.ContentType?.MediaType.ShouldBe("application/problem+json");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var problem = document.RootElement.Clone();
        problem.GetProperty("status").GetInt32().ShouldBe((int)status);
        problem.GetProperty("title").GetString().ShouldNotBeNullOrWhiteSpace();
        problem.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
        if (slug is not null)
        {
            problem.GetProperty("type").GetString().ShouldBe($"https://api.keyloop.example/problems/{slug}");
            problem.GetProperty("instance").GetString().ShouldNotBeNull().ShouldStartWith("/api/v1/__throw");
        }

        return problem;
    }

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : null;

    [GeneratedRegex("^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$")]
    private static partial Regex W3CTraceParent();
}

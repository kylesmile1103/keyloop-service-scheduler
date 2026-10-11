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
    public async Task Scalar_reference_is_served_at_scalar_v1()
    {
        using var response = await _client.GetAsync("/scalar/v1", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.ShouldBe("text/html");
        var html = await response.Content.ReadAsStringAsync(Ct);
        html.ShouldContain("Keyloop Service Scheduler API");
    }
}

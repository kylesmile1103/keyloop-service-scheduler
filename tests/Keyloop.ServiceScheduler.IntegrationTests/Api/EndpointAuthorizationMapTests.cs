using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Verifies that every mapped route explicitly declares its expected authorization policy.</summary>
public sealed class EndpointAuthorizationMapTests(PostgresFixture pg) : IAsyncLifetime
{
    private const string Public = "public";
    private const string Authenticated = "authenticated";

    /// <summary>Method and route pattern to the declared access: <c>public</c>, <c>authenticated</c>, or the named policy.</summary>
    private static readonly Dictionary<string, string> Expected = new(StringComparer.Ordinal)
    {
        ["GET /api/v1/dealerships"] = Public,
        ["GET /api/v1/dealerships/{dealershipId:guid}/service-types"] = Public,
        ["GET /api/v1/dealerships/{dealershipId:guid}/availability"] = Public,
        ["POST /api/v1/dealerships/{dealershipId:guid}/appointments"] = "BookingsWrite",
        ["GET /api/v1/appointments/{appointmentId:guid}"] = "AppointmentDetails",
        ["POST /api/v1/appointments/{appointmentId:guid}/cancel"] = "BookingsWrite",
        ["GET /api/v1/dealerships/{dealershipId:guid}/schedule"] = Public,
        ["GET /api/v1/booking-triage"] = Public,
        ["POST /api/v1/dealerships/{dealershipId:guid}/booking-triage"] = "BookingsWrite",
        ["POST /api/v1/dealerships/{dealershipId:guid}/booking-triage/images"] = "BookingsWrite",
        ["GET /api/v1/dealerships/{dealershipId:guid}/appointments"] = Public,
        ["POST /api/v1/vehicle-profiles/resolve"] = "BookingsWrite",
        ["POST /api/v1/dealerships/{dealershipId:guid}/customer-lookups"] = "BookingsWrite",
        ["GET /api/v1/me"] = Public,
        ["GET /api/v1/features"] = Public,
        ["GET /api/v1/dealerships/{dealershipId:guid}/technicians"] = "Admin",
        ["POST /api/v1/dealerships/{dealershipId:guid}/technicians"] = "Admin",
        ["GET /api/v1/dealerships/{dealershipId:guid}/technicians/{technicianId:guid}"] = "Admin",
        ["PUT /api/v1/dealerships/{dealershipId:guid}/technicians/{technicianId:guid}"] = "Admin",
        ["POST /api/v1/dealerships/{dealershipId:guid}/technicians/{technicianId:guid}/confirm-hv-level"] = "Admin",
        ["GET /api/v1/dealerships/{dealershipId:guid}/bays"] = "Admin",
        ["POST /api/v1/dealerships/{dealershipId:guid}/bays"] = "Admin",
        ["GET /api/v1/dealerships/{dealershipId:guid}/bays/{bayId:guid}"] = "Admin",
        ["PUT /api/v1/dealerships/{dealershipId:guid}/bays/{bayId:guid}"] = "Admin",
        ["GET /api/v1/dealerships/{dealershipId:guid}/requirement-policy"] = "Admin",
        ["PUT /api/v1/dealerships/{dealershipId:guid}/requirement-policy"] = "Admin",
        ["GET /api/v1/dealerships/{dealershipId:guid}/admin-history"] = "Admin",

        ["POST /api/v1/admin/demo/reseed"] = "Admin",
        ["GET /api/v1/__throw"] = Public,
        ["GET /auth/login"] = Authenticated,
        ["* /health"] = Public,
        ["* /alive"] = Public,
        ["GET /openapi/{documentName}.json"] = Public,
        ["GET /scalar/{documentName?}"] = Public,
        ["GET /scalar/scalar.js"] = Public,
        ["GET /scalar/scalar.aspnetcore.js"] = Public,
        ["GET /scalar/favicon.svg"] = Public,
    };

    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public void Every_mapped_route_declares_the_expected_access()
    {
        using var host = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Database:SeedDemoData", "true").UseSetting("Demo:ReseedKey", "test-reseed-key-1234567890123456"));
        var actual = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var endpoint in host.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>())
        {
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["*"];
            foreach (var method in methods)
            {
                actual[$"{method} {endpoint.RoutePattern.RawText}"] = Access(endpoint);
            }
        }

        var report = string.Join(Environment.NewLine, actual.Select(entry => $"{entry.Key} => {entry.Value}"));
        actual.Keys.Except(Expected.Keys).ShouldBeEmpty($"routes without a reviewed access decision:{Environment.NewLine}{report}");
        Expected.Keys.Except(actual.Keys).ShouldBeEmpty($"expected routes that are no longer mapped:{Environment.NewLine}{report}");
        foreach (var (route, access) in Expected)
        {
            actual[route].ShouldBe(access, route);
        }
    }

    /// <summary>Verifies that state-changing Admin routes apply the booking write rate limit.</summary>
    [Fact]
    public void Admin_writes_and_only_writes_carry_the_booking_write_rate_limit()
    {
        var admin = _factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => Access(e) == "Admin" && e.RoutePattern.RawText!.StartsWith("/api/v1/dealerships/", StringComparison.Ordinal))
            .SelectMany(e => (e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["*"])
                .Select(method => (Route: $"{method} {e.RoutePattern.RawText}", Policy: e.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName)))
            .ToList();
        admin.Count.ShouldBe(12);
        var writes = admin.Where(e => !e.Route.StartsWith("GET ", StringComparison.Ordinal)).ToList();
        writes.Count.ShouldBe(6);
        writes.ShouldAllBe(e => e.Policy == SchedulerRateLimiting.BookingPolicy);
        admin.Except(writes).ShouldAllBe(e => e.Policy == null);
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    [InlineData("/openapi/v1.json")]
    [InlineData("/scalar/v1")]
    [InlineData("/api/v1/__throw?kind=ok")]
    public async Task Infrastructure_routes_answer_anonymous_callers(string route)
    {
        using var client = AnonymousClient();
        using var response = await client.GetAsync(route, Ct);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Unauthorized, route);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden, route);
    }

    [Fact]
    public async Task Unknown_routes_and_wrong_methods_keep_routing_answers_for_anonymous_callers()
    {
        using var client = AnonymousClient();
        using var unknown = await client.GetAsync("/api/v1/no-such-route", Ct);
        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var malformedId = await client.GetAsync("/api/v1/appointments/not-a-guid", Ct);
        malformedId.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var wrongMethod = await client.DeleteAsync("/api/v1/dealerships", Ct);
        wrongMethod.StatusCode.ShouldBe(HttpStatusCode.MethodNotAllowed);
    }

    private HttpClient AnonymousClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        return client;
    }

    private static string Access(Endpoint endpoint)
    {
        if (endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
        {
            return Public;
        }

        var declared = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>();
        if (declared.Count == 0)
        {
            return "undeclared (fallback: Admin only)";
        }

        var policies = declared.Select(data => data.Policy ?? (data.Roles is null ? Authenticated : $"roles:{data.Roles}")).Distinct().ToList();
        return string.Join("+", policies);
    }
}

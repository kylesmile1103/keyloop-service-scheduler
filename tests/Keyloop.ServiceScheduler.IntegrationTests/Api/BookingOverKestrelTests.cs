using System.Net;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Tests booking over Kestrel to verify request-body size limits and ProblemDetails fields.</summary>
public sealed class BookingOverKestrelTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;
    private TestData.Workshop _workshop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        _factory.UseKestrel(0);
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public void Requests_go_over_a_real_socket()
    {
        _client.BaseAddress.ShouldNotBeNull().Scheme.ShouldBe("http");
        _client.BaseAddress.Port.ShouldNotBe(80, "Kestrel listens on a dynamic port");
    }

    [Fact]
    public async Task Body_larger_than_64_KB_is_rejected_with_413()
    {
        var booking = TestData.BookingRequest(_workshop.Interim.Id, new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc), notes: new string('n', 70 * 1024));
        var json = JsonSerializer.Serialize(booking, SchedulerJsonContext.Default.BookAppointmentRequest);
        Encoding.UTF8.GetByteCount(json).ShouldBeGreaterThan(64 * 1024);

        using var response = await _client.PostAsync(Url, new StringContent(json, Encoding.UTF8, "application/json"), Ct);

        var body = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge, body);

        response.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("application/problem+json");
        using var problem = JsonDocument.Parse(body);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://tools.ietf.org/html/rfc9110#section-15.5.14");
        root.GetProperty("title").GetString().ShouldBe("Content Too Large");
        root.GetProperty("status").GetInt32().ShouldBe(413);
        root.GetProperty("instance").GetString().ShouldBe(Url);
        root.GetProperty("traceId").GetString().ShouldNotBeNull().ShouldMatch("^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$");
        response.Headers.ConnectionClose.ShouldBe(true);
        await _factory.WithDbAsync(async db => (await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(db.Appointments, Ct)).ShouldBe(0));
    }

    [Fact]
    public async Task Validation_error_carries_traceId_and_instance()
    {
        var valid = TestData.BookingRequest(_workshop.Interim.Id, new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc));

        using var response = await _client.PostJsonAsync(
            Url, valid with { Vehicle = valid.Vehicle with { Vin = "short" } }, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);

        var problem = await response.ShouldBeValidationErrorAsync(["vehicle.vin"], Ct);
        problem.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments");
    }

    [Fact]
    public async Task An_empty_Idempotency_Key_is_a_400_not_an_absent_key()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Url)
        {
            Content = System.Net.Http.Json.JsonContent.Create(
                TestData.BookingRequest(_workshop.Interim.Id, new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc)), SchedulerJsonContext.Default.BookAppointmentRequest),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", string.Empty).ShouldBeTrue();

        using var response = await _client.SendAsync(request, Ct);

        await response.ShouldBeValidationErrorAsync(["Idempotency-Key"], Ct);
        await _factory.WithDbAsync(async db => (await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(db.Appointments, Ct)).ShouldBe(0));
    }

    private string Url => $"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments";
}

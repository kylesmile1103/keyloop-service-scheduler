using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class RequestCorrelationTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private string BookingUrl => $"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments";

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData(201)]
    [InlineData(400)]
    [InlineData(422)]
    [InlineData(429)]
    public async Task Booking_echoes_X_Request_Id(int status)
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:AllowedOrigins:0", "https://board.example")
            .UseSetting("Security:RateLimiting:Enabled", status == 429 ? "true" : "false")
            .UseSetting("Security:RateLimiting:GlobalPermitsPerMinute", "1"));
        using var client = factory.CreateClient();
        if (status == 429)
        {
            using var prime = await client.GetAsync("/api/v1/__throw?kind=ok", Ct);
            prime.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        }
        var requestId = Guid.NewGuid().ToString();
        var request = TestData.BookingRequest(_workshop.Interim.Id, status == 422 ? Ten.AddHours(12) : Ten);
        if (status == 400)
        {
            request = request with { StartUtc = Ten.AddSeconds(1) };
        }
        using var response = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest,
            new Dictionary<string, string> { ["X-Request-Id"] = requestId, ["Origin"] = "https://board.example" }, Ct);

        response.StatusCode.ShouldBe((HttpStatusCode)status);
        response.Headers.GetValues("X-Request-Id").ShouldBe([requestId]);
        response.Headers.GetValues("Access-Control-Allow-Origin").ShouldBe(["https://board.example"]);
        string.Join(",", response.Headers.GetValues("Access-Control-Expose-Headers")).ShouldContain("X-Request-Id");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-uuid")]
    [InlineData("00000000000000000000000000000001")]
    [InlineData("00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002")]
    [InlineData("00000000-0000-0000-0000-000000000001-extra")]
    public async Task Missing_or_invalid_request_id_is_replaced_on_every_response(string? supplied)
    {
        using var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/route-does-not-exist");
        if (supplied is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Request-Id", supplied);
        }
        using var response = await client.SendAsync(request, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var echoed = response.Headers.GetValues("X-Request-Id").ShouldHaveSingleItem();
        Guid.TryParseExact(echoed, "D", out _).ShouldBeTrue();
        echoed.ShouldNotBe(supplied);
    }

    [Fact]
    public async Task Every_operation_echoes_X_Request_Id_on_success_and_problem_responses()
    {
        using var client = _factory.CreateClient();
        using var booked = await client.PostJsonAsync(BookingUrl, TestData.BookingRequest(_workshop.Interim.Id, Ten), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        var appointment = await booked.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        var dealership = _workshop.Dealership.Id;
        var unknown = Guid.NewGuid();
        var cancel = new CancelAppointmentRequest("Customer called to reschedule.");
        var cancelUrl = $"/api/v1/appointments/{appointment.Id}/cancel";

        var calls = new (string Operation, HttpStatusCode Expected, Func<IReadOnlyDictionary<string, string>, Task<HttpResponseMessage>> Send)[]
        {
            ("GetDealerships", HttpStatusCode.OK, headers => GetAsync(client, "/api/v1/dealerships", headers)),
            ("GetServiceTypes", HttpStatusCode.OK, headers => GetAsync(client, $"/api/v1/dealerships/{dealership}/service-types", headers)),
            ("GetAvailability", HttpStatusCode.OK, headers => GetAsync(client, $"/api/v1/dealerships/{dealership}/availability?serviceTypeId={_workshop.Interim.Id}&date=2026-10-13", headers)),
            ("GetAppointment", HttpStatusCode.OK, headers => GetAsync(client, $"/api/v1/appointments/{appointment.Id}", headers)),
            ("GetAppointment", HttpStatusCode.NotFound, headers => GetAsync(client, $"/api/v1/appointments/{unknown}", headers)),
            ("CancelAppointment", HttpStatusCode.OK, headers => client.PostJsonAsync(cancelUrl, cancel, SchedulerJsonContext.Default.CancelAppointmentRequest, headers, Ct)),
            ("CancelAppointment", HttpStatusCode.Conflict, headers => client.PostJsonAsync(cancelUrl, cancel, SchedulerJsonContext.Default.CancelAppointmentRequest, headers, Ct)),
            ("GetWorkshopSchedule", HttpStatusCode.OK, headers => GetAsync(client, $"/api/v1/dealerships/{dealership}/schedule?date=2026-10-13", headers)),
            ("GetWorkshopSchedule", HttpStatusCode.BadRequest, headers => GetAsync(client, $"/api/v1/dealerships/{dealership}/schedule?date=13%2F10%2F2026", headers)),
            ("GetWorkshopSchedule", HttpStatusCode.NotFound, headers => GetAsync(client, $"/api/v1/dealerships/{unknown}/schedule?date=2026-10-13", headers)),
        };
        foreach (var (operation, expected, send) in calls)
        {
            var requestId = Guid.NewGuid().ToString();
            using var response = await send(new Dictionary<string, string> { ["X-Request-Id"] = requestId });
            response.StatusCode.ShouldBe(expected, operation);
            response.Headers.GetValues("X-Request-Id").ShouldBe([requestId], $"{operation} {(int)expected}");
        }
    }

    [Fact]
    public async Task Persistence_logs_carry_request_and_business_scopes_without_PII()
    {
        var logs = new CapturingLoggerProvider();
        var spans = new ConcurrentQueue<Activity>();
        using var listener = Listen(spans);
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command", "Information")
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        var requestId = Guid.NewGuid().ToString();
        const string key = "scoped-booking-intention";
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten, notes: "private-booking-notes");
        using var booked = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest,
            new Dictionary<string, string> { ["X-Request-Id"] = requestId, ["Idempotency-Key"] = key }, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        var appointment = await booked.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);

        var confirmed = logs.Entries.Where(e => e.EventId.Id == 1001).ShouldHaveSingleItem();
        AssertScope(confirmed, "ClientRequestId", requestId);
        AssertScope(confirmed, "DealershipId", _workshop.Dealership.Id);
        AssertScope(confirmed, "AppointmentId", appointment.Id);
        AssertScope(confirmed, "IdempotencyKey", key);
        var insert = logs.Entries.Where(e => e.Category == "Microsoft.EntityFrameworkCore.Database.Command" && e.Message.Contains("INSERT INTO appointments", StringComparison.Ordinal)).ShouldHaveSingleItem();
        AssertScope(insert, "ClientRequestId", requestId);
        AssertScope(insert, "DealershipId", _workshop.Dealership.Id);
        AssertScope(insert, "AppointmentId", appointment.Id);
        AssertScope(insert, "IdempotencyKey", key);
        spans.Any(s => Equals(s.GetTagItem("request.id"), requestId)).ShouldBeTrue("the server Activity carries the echoed request id");

        var cancelRequestId = Guid.NewGuid().ToString();
        using var cancelled = await client.PostJsonAsync($"/api/v1/appointments/{appointment.Id}/cancel",
            new CancelAppointmentRequest("private-cancellation-reason"), SchedulerJsonContext.Default.CancelAppointmentRequest,
            new Dictionary<string, string> { ["X-Request-Id"] = cancelRequestId }, Ct);
        cancelled.StatusCode.ShouldBe(HttpStatusCode.OK);
        var cancellation = logs.Entries.Where(e => e.EventId.Id == 1010).ShouldHaveSingleItem();
        var update = logs.Entries.Where(e => e.Category == "Microsoft.EntityFrameworkCore.Database.Command" && e.Message.Contains("UPDATE appointments", StringComparison.Ordinal)).ShouldHaveSingleItem();
        foreach (var entry in new[] { cancellation, update })
        {
            AssertScope(entry, "ClientRequestId", cancelRequestId);
            AssertScope(entry, "DealershipId", _workshop.Dealership.Id);
            AssertScope(entry, "AppointmentId", appointment.Id);
            entry.Scopes.Select(p => p.Key).ShouldNotContain("IdempotencyKey", "a cancellation has no booking key");
        }
        var recorded = string.Join("\n", logs.Entries.Select(e => e.Message + string.Join(";", e.State.Concat(e.Scopes))));
        foreach (var pii in new[] { request.Customer.Name, request.Customer.Email, request.Customer.Phone, request.Vehicle.Vin, request.Notes!, "private-cancellation-reason" })
        {
            recorded.ShouldNotContain(pii);
        }
        using var laterRequest = await client.GetAsync("/api/v1/__throw?kind=unexpected", Ct);
        var error = logs.Entries.Where(e => e.EventId.Id == 1200).ShouldHaveSingleItem();
        error.Scopes.Select(p => p.Key).ShouldNotContain("DealershipId", "a later request does not inherit an earlier request's business scopes");
        error.Scopes.Select(p => p.Key).ShouldNotContain("AppointmentId");
        error.Scopes.Select(p => p.Key).ShouldNotContain("IdempotencyKey");
        laterRequest.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
        var errorRequestId = laterRequest.Headers.GetValues("X-Request-Id").ShouldHaveSingleItem();
        Guid.TryParseExact(errorRequestId, "D", out _).ShouldBeTrue();
        AssertScope(error, "ClientRequestId", errorRequestId);
        error.Scopes.Where(p => p.Key == "ClientRequestId").Select(p => p.Value).ShouldNotContain(requestId);
        error.Scopes.Where(p => p.Key == "ClientRequestId").Select(p => p.Value).ShouldNotContain(cancelRequestId);
    }

    [Fact]
    public async Task Booking_refusal_is_logged_after_the_appointment_scope_is_disposed()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command", "Information")
            .ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        for (var capacity = 0; capacity < 2; capacity++)
        {
            using var booked = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
            booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        }

        var requestId = Guid.NewGuid().ToString();
        const string key = "refused-booking-intention";
        using var refused = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest,
            new Dictionary<string, string> { ["X-Request-Id"] = requestId, ["Idempotency-Key"] = key }, Ct);
        await refused.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct);

        var flow = logs.Entries.Where(e => e.Scopes.Any(p => p.Key == "ClientRequestId" && Equals(p.Value, requestId))).ToList();
        flow.Where(e => e.Category == "Microsoft.EntityFrameworkCore.Database.Command" && e.Message.Contains("pg_advisory_xact_lock", StringComparison.Ordinal))
            .ShouldHaveSingleItem().Scopes.Where(p => p.Key == "AppointmentId").ShouldHaveSingleItem().Value.ShouldBeOfType<Guid>();

        var rejected = flow.Where(e => e.EventId.Id == 1002).ShouldHaveSingleItem();
        AssertScope(rejected, "DealershipId", _workshop.Dealership.Id);
        AssertScope(rejected, "IdempotencyKey", key);
        rejected.Scopes.Select(p => p.Key).ShouldNotContain("AppointmentId", "the appointment scope is disposed when the transaction block ends");
    }

    [Fact]
    public async Task Early_idempotent_replay_span_has_the_stored_service_code()
    {
        using var client = _factory.CreateClient();
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        var headers = new Dictionary<string, string> { ["Idempotency-Key"] = "replay-service-code" };
        using var booked = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        var spans = new ConcurrentQueue<Activity>();
        using var listener = Listen(spans);

        using var replay = await client.PostJsonAsync(BookingUrl, request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);

        replay.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        var span = spans.Where(s => s.OperationName == "scheduler.book_appointment").ShouldHaveSingleItem();
        span.GetTagItem("booking.outcome").ShouldBe("replayed");
        span.GetTagItem("service_type.code").ShouldBe(_workshop.Interim.Code);
    }

    private static async Task<HttpResponseMessage> GetAsync(HttpClient client, string url, IReadOnlyDictionary<string, string> headers)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (name, value) in headers)
        {
            request.Headers.Add(name, value);
        }

        return await client.SendAsync(request, Ct);
    }

    private static void AssertScope(CapturingLoggerProvider.Entry entry, string name, object value) =>
        entry.Scopes.ShouldContain(property => property.Key == name && Equals(property.Value, value));

    private static ActivityListener Listen(ConcurrentQueue<Activity> spans)
    {
        var listener = new ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = spans.Enqueue,
        };
        ActivitySource.AddActivityListener(listener);
        return listener;
    }
}

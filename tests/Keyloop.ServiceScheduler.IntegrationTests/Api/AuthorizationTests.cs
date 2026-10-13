using System.Net;
using System.Net.Http.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Hosting;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class AuthorizationTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
    }
    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/appointments")]
    [InlineData("POST", "/api/v1/appointments/11111111-1111-1111-1111-111111111111/cancel")]
    [InlineData("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/booking-triage")]
    [InlineData("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/booking-triage/images")]
    [InlineData("GET", "/api/v1/appointments/11111111-1111-1111-1111-111111111111")]
    public async Task Anonymous_protected_routes_return_401_before_binding(string method, string route)
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Clear();
        using var request = new HttpRequestMessage(new HttpMethod(method), route)
        {
            Content = method == "POST" ? new StringContent("{}", System.Text.Encoding.UTF8, "application/json") : null,
        };
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        using var problem = await response.ReadProblemAsync(Ct);
        problem.RootElement.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/unauthenticated");
        problem.RootElement.GetProperty("loginUrl").GetString().ShouldStartWith("/auth/login?returnTo=");
    }
    [Theory]
    [InlineData("Anonymous", 401)]
    [InlineData("Unknown", 403)]
    [InlineData("Viewer", 403)]
    [InlineData("ServiceAdvisor", 403)]
    [InlineData("Admin", 200)]
    public async Task Demo_reseed_requires_Admin_and_the_existing_key(string role, int status)
    {
        const string key = "test-reseed-key-1234567890123456";
        using var host = _factory.WithWebHostBuilder(builder => builder.UseSetting("Database:SeedDemoData", "true").UseSetting("Demo:ReseedKey", key));
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/admin/demo/reseed");
        request.Headers.Add("X-Reseed-Key", key);
        using var response = await client.SendAsync(request, Ct);
        ((int)response.StatusCode).ShouldBe(status);
        if (role == "Admin")
        {
            using var withoutKey = await client.PostAsync("/api/v1/admin/demo/reseed", null, Ct);
            withoutKey.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        }
    }

    [Theory]
    [InlineData("Anonymous")]
    [InlineData("Unknown")]
    [InlineData("Viewer")]
    [InlineData("ServiceAdvisor")]
    [InlineData("Admin")]
    public async Task Every_public_read_is_available_without_a_required_role(string role)
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        foreach (var route in new[]
        {
            "/api/v1/dealerships", "/api/v1/booking-triage", "/api/v1/me",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/service-types",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/availability?serviceTypeId={workshop.Interim.Id}&date=2026-10-13",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/schedule?date=2026-10-13",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/appointments?from=2026-10-13&to=2026-10-13",
        })
        {
            using var response = await client.GetAsync(route, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.OK, route);
        }
    }

    [Theory]
    [InlineData("ServiceAdvisor")]
    [InlineData("Admin")]
    public async Task Write_roles_book_cancel_and_reach_triage_and_photo_upload(string role)
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        using var booked = await client.PostJsonAsync($"/api/v1/dealerships/{workshop.Dealership.Id}/appointments",
            TestData.BookingRequest(workshop.Interim.Id, TestData.LondonTime(9)), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        booked.StatusCode.ShouldBe(HttpStatusCode.Created);
        using var appointment = System.Text.Json.JsonDocument.Parse(await booked.Content.ReadAsStringAsync(Ct));
        var id = appointment.RootElement.GetProperty("id").GetGuid();
        using var cancelled = await client.PostJsonAsync($"/api/v1/appointments/{id}/cancel", new CancelAppointmentRequest("Customer requested cancellation"),
            SchedulerJsonContext.Default.CancelAppointmentRequest, Ct);
        cancelled.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var triage = await client.PostAsync($"/api/v1/dealerships/{workshop.Dealership.Id}/booking-triage",
            new StringContent("{\"description\":\"routine service\"}", System.Text.Encoding.UTF8, "application/json"), Ct);
        triage.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable, "triage is disabled in this fixture, but the write role passes authorization");
        using var upload = await client.PostAsync($"/api/v1/dealerships/{workshop.Dealership.Id}/booking-triage/images",
            new StringContent("{\"contentType\":\"image/png\",\"base64\":\"AA==\"}", System.Text.Encoding.UTF8, "application/json"), Ct);
        upload.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable, "image triage is disabled in this fixture, but the write role passes authorization");
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("text/html")]
    public async Task Unauthorized_problem_is_JSON_even_when_the_client_requests_other_content(string accept)
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Accept.ParseAdd(accept);
        using var response = await client.GetAsync("/api/v1/appointments/11111111-1111-1111-1111-111111111111", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        using var problem = await response.ReadProblemAsync(Ct);
        problem.RootElement.GetProperty("loginUrl").GetString().ShouldBe("/auth/login?returnTo=%2F");
        problem.RootElement.GetProperty("traceId").GetString().ShouldNotBeNullOrEmpty();
    }

    [Theory]
    [InlineData("/board?date=2026-10-13", "/board?date=2026-10-13")]
    [InlineData("https://evil.test", "/")]
    [InlineData("//evil.test", "/")]
    public async Task Login_navigation_returns_only_a_local_no_store_redirect(string target, string expected)
    {
        using var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        using var response = await client.GetAsync($"/auth/login?returnTo={Uri.EscapeDataString(target)}", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Redirect);
        response.Headers.Location!.OriginalString.ShouldBe(expected);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }

    public static TheoryData<string, string, string, int> RoleMatrix
    {
        get
        {
            var cases = new TheoryData<string, string, string, int>();
            foreach (var role in new[] { "Anonymous", "Unknown", "Viewer", "ServiceAdvisor", "Admin" })
            {
                foreach (var (method, route, details) in new[]
                {
                    ("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/appointments", false),
                    ("POST", "/api/v1/appointments/11111111-1111-1111-1111-111111111111/cancel", false),
                    ("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/booking-triage", false),
                    ("POST", "/api/v1/dealerships/11111111-1111-1111-1111-111111111111/booking-triage/images", false),
                    ("GET", "/api/v1/appointments/11111111-1111-1111-1111-111111111111", true),
                })
                {
                    cases.Add(role, method, route, role == "Anonymous" ? 401 : role == "Unknown" || (role == "Viewer" && !details) ? 403 : details ? 404 : 400);
                }
            }
            return cases;
        }
    }

    [Theory]
    [MemberData(nameof(RoleMatrix))]
    public async Task Route_role_matrix_is_enforced_before_binding(string role, string method, string route, int status)
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        using var request = new HttpRequestMessage(new HttpMethod(method), route)
        {
            Content = method == "POST" ? new StringContent("{}", System.Text.Encoding.UTF8, "application/json") : null,
        };
        using var response = await client.SendAsync(request, Ct);
        ((int)response.StatusCode).ShouldBe(status);
        if (status is 401 or 403)
        {
            using var problem = await response.ReadProblemAsync(Ct);
            problem.RootElement.GetProperty("type").GetString().ShouldBe($"https://api.keyloop.example/problems/{(status == 401 ? "unauthenticated" : "forbidden")}");
            problem.RootElement.GetProperty("traceId").GetString().ShouldNotBeNullOrEmpty();
            response.Headers.Contains("X-Request-Id").ShouldBeTrue();
        }
    }

    [Theory]
    [InlineData("Anonymous", false)]
    [InlineData("Unknown", true)]
    [InlineData("Viewer", true)]
    [InlineData("ServiceAdvisor", true)]
    [InlineData("Admin", true)]
    public async Task Current_user_reports_identity_roles_and_access_urls(string role, bool authenticated)
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        using var response = await client.GetAsync("/api/v1/me", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var body = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var me = body.RootElement;
        me.GetProperty("authenticated").GetBoolean().ShouldBe(authenticated);
        me.GetProperty("email").GetString().ShouldBe(authenticated ? "test-user@keyloop.test" : null);
        me.GetProperty("roles").EnumerateArray().Select(item => item.GetString()).ShouldBe(role is "Anonymous" or "Unknown" ? [] : new[] { role });
        me.GetProperty("loginUrl").GetString().ShouldBe("/auth/login?returnTo=%2F");
        me.GetProperty("logoutUrl").GetString().ShouldBe("/cdn-cgi/access/logout");
        me.GetProperty("expiresAtUtc").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
    }

    [Theory]
    [InlineData("Anonymous", "ALS", "***********123456", "*******")]
    [InlineData("Unknown", "ALS", "***********123456", "*******")]
    [InlineData("Viewer", "Alice Louise Smith", "WVWZZZ1KZAW123456", "AB12 CDE")]
    [InlineData("ServiceAdvisor", "Alice Louise Smith", "WVWZZZ1KZAW123456", "AB12 CDE")]
    [InlineData("Admin", "Alice Louise Smith", "WVWZZZ1KZAW123456", "AB12 CDE")]
    public async Task Both_public_reads_mask_personal_data_unless_caller_has_any_role(string role, string name, string vin, string registration)
    {
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        var appointment = TestData.NewAppointment(workshop.Dealership, workshop.Interim, workshop.Bay1, workshop.Technician1,
            TestData.LondonTime(9), customer: 1, vin: "WVWZZZ1KZAW123456", id: TestData.PlateLookalikeId());
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE appointments SET customer_name = {"Alice Louise Smith"} WHERE id = {appointment.Id}", Ct);
        });
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, role);
        foreach (var route in new[] { $"/api/v1/dealerships/{workshop.Dealership.Id}/schedule?date=2026-10-13", $"/api/v1/dealerships/{workshop.Dealership.Id}/appointments?from=2026-10-13&to=2026-10-13" })
        {
            using var response = await client.GetAsync(route, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            using var body = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
            var item = route.Contains("/schedule", StringComparison.Ordinal)
                ? body.RootElement.GetProperty("bays")[0].GetProperty("appointments")[0] : body.RootElement[0];
            item.GetProperty("customerName").GetString().ShouldBe(name);
            item.GetProperty("vin").GetString().ShouldBe(vin);
            item.GetProperty("registration").GetString().ShouldBe(registration);
            if (role is "Anonymous" or "Unknown")
            {
                var raw = body.RootElement.GetRawText();
                raw.ShouldNotContain("Alice");
                raw.ShouldNotContain("WVWZZZ1KZAW");
                // Shouldly ignores case by default, and every id in the body is lowercase hex (the appointment's starts ab12cde0).
                raw.ShouldNotContain("AB12", Case.Sensitive);
                raw.ShouldNotContain("CDE", Case.Sensitive);
            }
        }
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/x-www-form-urlencoded")]
    [InlineData("multipart/form-data; boundary=x")]
    public async Task Cookie_authenticated_writes_reject_the_content_types_a_cross_site_form_can_send(string contentType)
    {
        // Rejects form and plain-text content types with 415 to prevent cross-site form submissions.
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, "ServiceAdvisor");
        foreach (var route in new[]
        {
            $"/api/v1/dealerships/{workshop.Dealership.Id}/appointments",
            "/api/v1/appointments/11111111-1111-1111-1111-111111111111/cancel",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/booking-triage",
            $"/api/v1/dealerships/{workshop.Dealership.Id}/booking-triage/images",
        })
        {
            using var content = new StringContent("{}");
            content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
            using var response = await client.PostAsync(route, content, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType, route);
        }

        (await _factory.WithDbAsync(db => db.Appointments.CountAsync(Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task A_verified_email_of_the_maximum_length_is_recorded_as_the_audit_actor()
    {
        // RFC 5321 limits a path to 254 characters; a 64-character local part on a long domain reaches it.
        var email = $"{new string('a', 64)}@{new string('b', 63)}.{new string('c', 63)}.{new string('d', 56)}.test";
        email.Length.ShouldBe(254);
        var workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Remove(TestAuthenticationHandler.Header);
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, "ServiceAdvisor");
        client.DefaultRequestHeaders.Add("X-Test-Email", email);

        using var booked = await client.PostJsonAsync($"/api/v1/dealerships/{workshop.Dealership.Id}/appointments",
            TestData.BookingRequest(workshop.Interim.Id, TestData.LondonTime(9)), SchedulerJsonContext.Default.BookAppointmentRequest, Ct);

        booked.StatusCode.ShouldBe(HttpStatusCode.Created, await booked.Content.ReadAsStringAsync(Ct));
        var actors = await _factory.WithDbAsync(db => db.AppointmentHistory.Select(h => h.Actor).ToListAsync(Ct));
        actors.ShouldBe([$"user:{email}"]);
    }

}

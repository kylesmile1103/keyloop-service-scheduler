using System.Net;
using System.Text.Json;
using System.Text;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// <c>GET /api/v1/appointments/{appointmentId}</c> and <c>POST /api/v1/appointments/{appointmentId}/cancel</c>: reading a booking back
/// (including through the booking's <c>Location</c>), the cancel transition with its audit row, telemetry and problems (ARCHITECTURE
/// §5.5, §8.7), the slot it frees (Review Focus 3), and optimistic concurrency on the row's <c>xmin</c> (§7.3 layer 3). The workshop is
/// Test Motors (Europe/London) with two standard bays, two general technicians and a 60-minute interim service; the clock is Monday
/// 2026-10-12 08:00Z and the booking day Tuesday 2026-10-13.
/// </summary>
public sealed class AppointmentLifecycleTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc); // 11:00 BST

    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;
    private TestData.Workshop _workshop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
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
    public async Task Get_returns_booked_appointment()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, notes: "Rattle from the front left wheel."));

        using var response = await _client.GetAsync($"/api/v1/appointments/{booked.Id}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var appointment = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        appointment.ShouldBe(booked, "the read shows exactly what the booking answered");
        (appointment.Status, appointment.CancellationReason).ShouldBe((AppointmentStatus.Confirmed, null));
        (appointment.StartLocal, appointment.EndLocal).ShouldBe(("2026-10-13T11:00+01:00", "2026-10-13T12:00+01:00"));
    }

    [Fact]
    public async Task Location_of_a_booking_and_of_its_replay_resolves_to_the_appointment()
    {
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        var headers = new Dictionary<string, string> { ["Idempotency-Key"] = "follow-the-location" };
        using var created = await _client.PostJsonAsync(BookingUrl(_workshop.Dealership.Id), request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        using var replayed = await _client.PostJsonAsync(BookingUrl(_workshop.Dealership.Id), request, SchedulerJsonContext.Default.BookAppointmentRequest, headers, Ct);
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        replayed.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        var booked = await created.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);

        foreach (var location in new[] { created.Headers.Location, replayed.Headers.Location })
        {
            // As a client follows it: a relative reference resolved against the request's URI.
            using var response = await _client.GetAsync(location.ShouldNotBeNull(), Ct);

            response.StatusCode.ShouldBe(HttpStatusCode.OK, location.OriginalString);
            (await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).ShouldBe(booked);
        }
    }

    [Fact]
    public async Task Get_unknown_404()
    {
        var id = Guid.NewGuid();

        using var response = await _client.GetAsync($"/api/v1/appointments/{id}", Ct);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "not-found", Ct);
        problem.GetProperty("resource").GetString().ShouldBe("appointment");
        problem.GetProperty("id").GetGuid().ShouldBe(id);
    }

    [Fact]
    public async Task Cancel_sets_status_and_reason_and_writes_history()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, notes: "Rattle from the front left wheel."), client);
        _factory.Clock.Advance(TimeSpan.FromMinutes(30));
        var cancelledAt = TestData.Now.AddMinutes(30);
        using var metrics = new MetricsCollector();

        using var response = await CancelAsync(booked.Id, "  Customer called to reschedule.  ", client);

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        var cancelled = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        cancelled.ShouldBe(booked with
        {
            Status = AppointmentStatus.Cancelled,
            CancellationReason = "Customer called to reschedule.", // trimmed by the aggregate
            UpdatedAtUtc = cancelledAt,
        });

        using (var read = await client.GetAsync($"/api/v1/appointments/{booked.Id}", Ct))
        {
            (await read.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).ShouldBe(cancelled, "the cancellation is what a read now shows");
        }

        await _factory.WithDbAsync(async db =>
        {
            var row = await db.Appointments.AsNoTracking().SingleAsync(Ct);
            (row.Status, row.CancellationReason, row.UpdatedAtUtc).ShouldBe((AppointmentStatus.Cancelled, "Customer called to reschedule.", cancelledAt));

            var history = await db.AppointmentHistory.AsNoTracking().OrderBy(h => h.OccurredAtUtc).ToListAsync(Ct);
            history.Select(h => (h.AppointmentId, h.EventType, h.OccurredAtUtc)).ShouldBe(
                [(booked.Id, "Booked", TestData.Now), (booked.Id, "Cancelled", cancelledAt)]);
            history[1].Actor.ShouldBe("user:test-user@keyloop.test");
            using var payload = JsonDocument.Parse(history[1].Payload);
            payload.RootElement.GetProperty("previousStatus").GetString().ShouldBe("Confirmed");
            payload.RootElement.GetProperty("reason").GetString().ShouldBe("Customer called to reschedule.");
        });

        // 1010 comes from the post-commit observer, once; the reason is free text that may carry PII and is never logged (§11.1).
        var logged = logs.Entries.Where(e => e.EventId.Id == 1010).ShouldHaveSingleItem();
        logged.Message.ShouldContain(booked.Id.ToString());
        logs.Entries.ShouldNotContain(e => e.Message.Contains("reschedule", StringComparison.Ordinal));
        metrics.Sum("scheduler.appointments.cancellations", MetricsCollector.Tag("previous_status", "Confirmed")).ShouldBe(1);
        metrics.Sum("scheduler.appointments.cancellations").ShouldBe(1);
    }

    [Fact]
    public async Task Cancels_a_checked_in_appointment_and_counts_its_previous_status()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));
        await TransitionAsync(booked.Id, (appointment, now) => appointment.CheckIn(now)); // no check-in endpoint in this slice (§5.5)
        using var metrics = new MetricsCollector();

        using var response = await CancelAsync(booked.Id, "Customer collected the car unserviced.");

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync(Ct));
        (await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).Status.ShouldBe(AppointmentStatus.Cancelled);
        metrics.Sum("scheduler.appointments.cancellations", MetricsCollector.Tag("previous_status", "CheckedIn")).ShouldBe(1);
    }

    [Fact]
    public async Task Cancel_twice_409_invalid_state_transition()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));
        using (var first = await CancelAsync(booked.Id, "Customer called to reschedule."))
        {
            first.StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        using var second = await CancelAsync(booked.Id, "Customer called to reschedule.");

        var problem = await second.ShouldBeProblemAsync(HttpStatusCode.Conflict, "invalid-state-transition", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Invalid state transition");
        problem.GetProperty("detail").GetString().ShouldBe("Cannot cancel this appointment while it is Cancelled.");
        problem.GetProperty("currentStatus").GetString().ShouldBe("Cancelled");
        problem.GetProperty("attempted").GetString().ShouldBe("cancel");
        await _factory.WithDbAsync(async db =>
        {
            (await db.AppointmentHistory.Select(h => h.EventType).ToListAsync(Ct)).ShouldBe(["Booked", "Cancelled"], ignoreOrder: true, customMessage: "the refused cancel writes nothing");
        });
    }

    [Fact]
    public async Task Cancel_after_work_started_409_with_the_current_status()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));
        await TransitionAsync(booked.Id, (appointment, now) =>
        {
            appointment.CheckIn(now);
            appointment.Start(now);
        });

        using var response = await CancelAsync(booked.Id, "Too late to cancel.");

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "invalid-state-transition", Ct);
        problem.GetProperty("currentStatus").GetString().ShouldBe("InProgress");
        problem.GetProperty("attempted").GetString().ShouldBe("cancel");
        await _factory.WithDbAsync(async db => (await db.Appointments.SingleAsync(Ct)).Status.ShouldBe(AppointmentStatus.InProgress));
    }

    [Fact]
    public async Task Cancel_unknown_404()
    {
        var id = Guid.NewGuid();

        using var response = await CancelAsync(id, "Customer called to reschedule.");

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, "not-found", Ct);
        problem.GetProperty("resource").GetString().ShouldBe("appointment");
        problem.GetProperty("id").GetGuid().ShouldBe(id);
    }

    [Theory]
    [InlineData("""{"reason":""}""")]
    [InlineData("""{"reason":"   "}""")]
    [InlineData("""{"reason":null}""")]
    [InlineData("""{}""")]
    public async Task Cancel_empty_reason_400(string body)
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));

        using var response = await PostRawAsync(booked.Id, body);

        var problem = await response.ShouldBeValidationErrorAsync(["reason"], Ct);
        problem.GetProperty("errors").GetProperty("reason")[0].GetString().ShouldBe("reason is required, 1 to 500 characters after trimming.");
        await ShouldStillBeConfirmedAsync(booked.Id);
    }

    [Fact]
    public async Task Cancel_reason_longer_than_500_characters_400()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));

        using var response = await CancelAsync(booked.Id, new string('r', Appointment.MaxCancellationReasonLength + 1));

        await response.ShouldBeValidationErrorAsync(["reason"], Ct);
        await ShouldStillBeConfirmedAsync(booked.Id);
    }

    [Fact]
    public async Task Cancel_without_a_body_400()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));

        using var response = await _client.PostAsync($"/api/v1/appointments/{booked.Id}/cancel", new StringContent("", Encoding.UTF8, "application/json"), Ct);

        await response.ShouldBeValidationErrorAsync([], Ct);
        await ShouldStillBeConfirmedAsync(booked.Id);
    }

    [Fact]
    public async Task Cancelled_slot_can_be_rebooked_on_same_bay_and_technician()
    {
        // Review Focus 3: one bay and one technician, so the only way to book the slot again is on the very resources it held.
        var (dealershipId, serviceTypeId, bayId, technicianId) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var first = await BookAsync(TestData.BookingRequest(serviceTypeId, Ten, customerIndex: 1), dealershipId: dealershipId);
        using (var blocked = await PostBookingAsync(dealershipId, TestData.BookingRequest(serviceTypeId, Ten, customerIndex: 2)))
        {
            await blocked.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct); // taken while the first is active
        }

        using (var cancel = await CancelAsync(first.Id, "Customer called to reschedule."))
        {
            cancel.StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        var second = await BookAsync(TestData.BookingRequest(serviceTypeId, Ten, customerIndex: 2), dealershipId: dealershipId);

        (second.Bay.Id, second.Technician.Id, second.StartUtc, second.EndUtc).ShouldBe((bayId, technicianId, first.StartUtc, first.EndUtc));
        await _factory.WithDbAsync(async db =>
        {
            var rows = await db.Appointments.AsNoTracking().Where(a => a.DealershipId == dealershipId).OrderBy(a => a.CreatedAtUtc).ThenBy(a => a.Id)
                .Select(a => new { a.Id, a.Status, a.BayId, a.TechnicianId, a.Slot.StartUtc })
                .ToListAsync(Ct);
            rows.Select(r => (r.Id, r.Status)).ShouldBe([(first.Id, AppointmentStatus.Cancelled), (second.Id, AppointmentStatus.Confirmed)], ignoreOrder: true);
            rows.ShouldAllBe(r => r.BayId == bayId && r.TechnicianId == technicianId && r.StartUtc == Ten);
        });
    }

    [Fact]
    public async Task Concurrent_cancel_second_writer_gets_409_concurrency_conflict()
    {
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten));

        // The first writer loads the row now, through its own context, and cancels between the API's read and its UPDATE.
        await using var scope = _factory.Services.CreateAsyncScope();
        var firstWriter = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var loaded = await firstWriter.Appointments.SingleAsync(a => a.Id == booked.Id, Ct);
        var interleave = new BeforeAppointmentUpdate(async ct =>
        {
            loaded.Cancel("Cancelled by the workshop.", TestData.Now);
            await firstWriter.SaveChangesAsync(ct);
        });
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.ConfigureDbContext<SchedulerDbContext>(options => options.AddInterceptors(interleave))));
        using var client = factory.CreateClient();
        interleave.Arm();

        using var response = await CancelAsync(booked.Id, "Cancelled by the customer.", client);

        interleave.Fired.ShouldBe(1, "the first writer committed between the API's read and its write");
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, "concurrency-conflict", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Concurrency conflict");
        await _factory.WithDbAsync(async db =>
        {
            var row = await db.Appointments.AsNoTracking().SingleAsync(Ct);
            (row.Status, row.CancellationReason).ShouldBe((AppointmentStatus.Cancelled, "Cancelled by the workshop."), "first writer wins");
            // The loser's audit row rolled back with its UPDATE: one cancellation in the history, the winner's.
            var cancellation = await db.AppointmentHistory.AsNoTracking().Where(h => h.EventType == "Cancelled").SingleAsync(Ct);
            using var payload = JsonDocument.Parse(cancellation.Payload);
            payload.RootElement.GetProperty("reason").GetString().ShouldBe("Cancelled by the workshop.");
        });
    }

    [Fact]
    public async Task Cancel_counts_against_the_write_rate_limit()
    {
        await using var factory = _factory.WithWebHostBuilder(builder => builder
            .UseSetting("Security:RateLimiting:Enabled", "true")
            .UseSetting("Security:RateLimiting:BookingPermitsPerMinute", "1"));
        using var client = factory.CreateClient();
        var booked = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten), client); // the minute's one write

        using var response = await CancelAsync(booked.Id, "Customer called to reschedule.", client);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.TooManyRequests, "rate-limited", Ct);
        problem.GetProperty("retryAfterSeconds").GetInt32().ShouldBeGreaterThan(0);
        await ShouldStillBeConfirmedAsync(booked.Id);
        using var read = await client.GetAsync($"/api/v1/appointments/{booked.Id}", Ct);
        read.StatusCode.ShouldBe(HttpStatusCode.OK, "reads stay under the global limiter only");
    }

    private static string BookingUrl(Guid dealershipId) => $"/api/v1/dealerships/{dealershipId}/appointments";

    private Task<HttpResponseMessage> PostBookingAsync(Guid dealershipId, BookAppointmentRequest request, HttpClient? client = null) =>
        (client ?? _client).PostJsonAsync(BookingUrl(dealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);

    private async Task<AppointmentResponse> BookAsync(BookAppointmentRequest request, HttpClient? client = null, Guid? dealershipId = null)
    {
        using var response = await PostBookingAsync(dealershipId ?? _workshop.Dealership.Id, request, client);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
    }

    private Task<HttpResponseMessage> CancelAsync(Guid appointmentId, string reason, HttpClient? client = null) =>
        (client ?? _client).PostJsonAsync(
            $"/api/v1/appointments/{appointmentId}/cancel", new CancelAppointmentRequest(reason), SchedulerJsonContext.Default.CancelAppointmentRequest, Ct);

    private Task<HttpResponseMessage> PostRawAsync(Guid appointmentId, string json) =>
        _client.PostAsync($"/api/v1/appointments/{appointmentId}/cancel", new StringContent(json, Encoding.UTF8, "application/json"), Ct);

    /// <summary>Applies lifecycle steps the API has no endpoint for yet, through the aggregate (so they are audited like any other).</summary>
    private Task TransitionAsync(Guid appointmentId, Action<Appointment, DateTime> transition) => _factory.WithDbAsync(async db =>
    {
        var appointment = await db.Appointments.SingleAsync(a => a.Id == appointmentId, Ct);
        transition(appointment, TestData.Now);
        await db.SaveChangesAsync(Ct);
    });

    private Task ShouldStillBeConfirmedAsync(Guid appointmentId) => _factory.WithDbAsync(async db =>
    {
        var row = await db.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId, Ct);
        (row.Status, row.CancellationReason).ShouldBe((AppointmentStatus.Confirmed, null));
        (await db.AppointmentHistory.CountAsync(h => h.AppointmentId == appointmentId, Ct)).ShouldBe(1, "only the booking is audited");
    });
}

using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>Tests Idempotency-Key handling, replay behavior, expiration, and conflict detection on appointment bookings.</summary>
public sealed class IdempotencyTests(PostgresFixture pg) : IAsyncLifetime
{
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

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
    public async Task Same_key_same_body_replays_201_without_second_row()
    {
        var (dealershipId, serviceTypeId, _, _) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var request = TestData.BookingRequest(serviceTypeId, Ten);
        using var metrics = new MetricsCollector();

        using var first = await PostAsync(dealershipId, request, "retry-key-1");
        using var second = await PostAsync(dealershipId, request, "retry-key-1");

        first.StatusCode.ShouldBe(HttpStatusCode.Created);
        first.Headers.Contains("Idempotent-Replayed").ShouldBeFalse();
        second.StatusCode.ShouldBe(HttpStatusCode.Created, await second.Content.ReadAsStringAsync(Ct));
        second.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        second.Headers.Location.ShouldBe(first.Headers.Location);
        var body = await first.Content.ReadAsStringAsync(Ct);
        (await second.Content.ReadAsStringAsync(Ct)).ShouldBe(body, "the replay is the stored 201 body, byte for byte");
        var appointment = await first.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);

        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(1);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
            var key = await db.IdempotencyKeys.AsNoTracking().SingleAsync(Ct);
            key.Key.ShouldBe("retry-key-1");
            key.ResourceId.ShouldBe(appointment.Id);
            key.ResponseStatus.ShouldBe(201);
            key.RequestFingerprint.ShouldBe(IdempotencyFingerprint.Compute(dealershipId, request));
            (key.CreatedAtUtc, key.ExpiresAtUtc).ShouldBe((TestData.Now, TestData.Now.AddHours(24)));
        });
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "confirmed")).ShouldBe(1);
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "replayed")).ShouldBe(1);
        metrics.Of("scheduler.booking.lock_wait").Count.ShouldBe(1, "a sequential retry is answered before the transaction");
    }

    [Fact]
    public async Task Unkeyed_client_retry_with_spare_capacity_creates_two_distinct_allocations()
    {
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        using var first = await PostAsync(_workshop.Dealership.Id, request, null);
        using var retry = await PostAsync(_workshop.Dealership.Id, request, null);

        first.StatusCode.ShouldBe(HttpStatusCode.Created);
        retry.StatusCode.ShouldBe(HttpStatusCode.Created, "each unkeyed HTTP request is a new booking when capacity remains");
        retry.Headers.Contains("Idempotent-Replayed").ShouldBeFalse();
        var original = await first.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        var duplicate = await retry.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        duplicate.Id.ShouldNotBe(original.Id);
        duplicate.Bay.Id.ShouldNotBe(original.Bay.Id);
        duplicate.Technician.Id.ShouldNotBe(original.Technician.Id);
        (duplicate.Customer, duplicate.Vehicle, duplicate.StartUtc).ShouldBe((original.Customer, original.Vehicle, original.StartUtc));
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(2);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(2);
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0);
        });
        using var third = await PostAsync(_workshop.Dealership.Id, request, null);
        await third.ShouldBeProblemAsync(HttpStatusCode.Conflict, "slot-unavailable", Ct);
    }

    [Fact]
    public async Task Stable_key_client_retry_with_spare_capacity_replays_one_appointment()
    {
        var request = TestData.BookingRequest(_workshop.Interim.Id, Ten);
        using var first = await PostAsync(_workshop.Dealership.Id, request, "one-booking-intention");
        using var retry = await PostAsync(_workshop.Dealership.Id, request, "one-booking-intention");

        first.StatusCode.ShouldBe(HttpStatusCode.Created);
        retry.StatusCode.ShouldBe(HttpStatusCode.Created);
        retry.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        (await retry.Content.ReadAsStringAsync(Ct)).ShouldBe(await first.Content.ReadAsStringAsync(Ct));
        retry.Headers.Location.ShouldBe(first.Headers.Location);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(1);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(1);
        });
    }

    [Fact]
    public async Task Concurrent_requests_with_the_same_key_and_body_book_once_and_both_get_201()
    {
        // Hold the dealership lock so both requests pass the initial lookup and serialize on the in-lock re-check.
        var (dealershipId, serviceTypeId, _, _) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var request = TestData.BookingRequest(serviceTypeId, Ten);
        HttpResponseMessage[] responses;
        await using (var holder = await HoldDealershipLockAsync(dealershipId))
        {
            var inFlight = new[] { PostAsync(dealershipId, request, "concurrent-key"), PostAsync(dealershipId, request, "concurrent-key") };
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 2, Ct);
            await holder.CommitAsync(Ct);
            responses = await Task.WhenAll(inFlight);
        }

        try
        {
            responses.ShouldAllBe(r => r.StatusCode == HttpStatusCode.Created);
            responses.Count(r => r.Headers.Contains("Idempotent-Replayed")).ShouldBe(1);
            var bodies = await Task.WhenAll(responses.Select(r => r.Content.ReadAsStringAsync(Ct)));
            bodies[1].ShouldBe(bodies[0]);
            responses[1].Headers.Location.ShouldBe(responses[0].Headers.Location);
            await _factory.WithDbAsync(async db =>
            {
                (await db.Appointments.CountAsync(Ct)).ShouldBe(1);
                (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(1);
            });
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task Same_key_at_two_dealerships_concurrently_books_once_and_rejects_the_other_422()
    {
        // Hold row locks on both dealerships so the two requests collide on the idempotency_keys primary key constraint (23505).
        var elsewhere = TestData.NewDealership("Elsewhere Motors");
        await SaveAsync(
            elsewhere,
            TestData.NewBay(elsewhere.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(elsewhere.Id, "Chloe Dubois", "E-1001", Certification.GeneralService));
        using var metrics = new MetricsCollector();
        var logs = new CapturingLoggerProvider();
        await using var factory = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<ILoggerProvider>(logs)));
        using var client = factory.CreateClient();
        HttpResponseMessage[] responses;
        await using (var connection = new NpgsqlConnection(pg.ConnectionString))
        {
            await connection.OpenAsync(Ct);
            await using var holder = await connection.BeginTransactionAsync(Ct);
            await using (var rowLocks = new NpgsqlCommand("SELECT id FROM dealerships WHERE id = ANY(@ids) FOR UPDATE", connection, holder))
            {
                rowLocks.Parameters.AddWithValue("ids", new[] { _workshop.Dealership.Id, elsewhere.Id });
                await rowLocks.ExecuteNonQueryAsync(Ct);
            }

            var inFlight = new[]
            {
                PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), "shared-key", client),
                PostAsync(elsewhere.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), "shared-key", client),
            };
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 2, Ct);
            await holder.CommitAsync(Ct);
            responses = await Task.WhenAll(inFlight);
        }

        try
        {
            responses.Select(r => r.StatusCode).ShouldBe([HttpStatusCode.Created, HttpStatusCode.UnprocessableEntity], ignoreOrder: true);
            var created = responses.Single(r => r.StatusCode == HttpStatusCode.Created);
            var appointment = await created.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
            await responses.Single(r => r.StatusCode != HttpStatusCode.Created).ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "idempotency-key-reuse", Ct);
            await _factory.WithDbAsync(async db =>
            {
                (await db.Appointments.Select(a => a.Id).ToListAsync(Ct)).ShouldBe([appointment.Id]);
                (await db.IdempotencyKeys.SingleAsync(Ct)).ResourceId.ShouldBe(appointment.Id);
                (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(1);
            });
            metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "idempotency_reuse")).ShouldBe(1);
            metrics.Sum("scheduler.booking.constraint_backstop").ShouldBe(0, "a duplicate key is not an overlap");
            logs.Entries.ShouldNotContain(e => e.Level >= LogLevel.Error, string.Join(Environment.NewLine, logs.Entries.Where(e => e.Level >= LogLevel.Error)));
            logs.Entries.Count(e => e.EventId.Id == 1002).ShouldBe(1, "the loser is a rejection (idempotency_reuse)");
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task A_duplicate_key_whose_stored_row_is_expired_is_not_replayed_but_booked()
    {
        var elsewhere = TestData.NewDealership("Elsewhere Motors");
        await SaveAsync(
            elsewhere,
            TestData.NewBay(elsewhere.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(elsewhere.Id, "Chloe Dubois", "E-1001", Certification.GeneralService));
        await using var behind = new SchedulerApiFactory(pg.ConnectionString, new FakeTimeProvider(TestData.DefaultNow.AddHours(-25)));
        using var behindClient = behind.CreateClient();

        await using var holdA = await HoldDealershipRowAsync(_workshop.Dealership.Id);
        await using var holdB = await HoldDealershipRowAsync(elsewhere.Id);
        var aTask = PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), "skewed-key");
        var bTask = PostAsync(elsewhere.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2), "skewed-key", behindClient);
        await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 2, Ct);

        await holdB.CommitAsync(Ct);
        using var b = await bTask;
        b.StatusCode.ShouldBe(HttpStatusCode.Created, await b.Content.ReadAsStringAsync(Ct));
        await holdA.CommitAsync(Ct);
        using var a = await aTask;

        a.StatusCode.ShouldBe(HttpStatusCode.Created, await a.Content.ReadAsStringAsync(Ct));
        a.Headers.Contains("Idempotent-Replayed").ShouldBeFalse("B's expired row is not A's booking");
        var booked = await a.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        booked.DealershipId.ShouldBe(_workshop.Dealership.Id);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(2);
            var key = await db.IdempotencyKeys.AsNoTracking().SingleAsync(Ct);
            key.ResourceId.ShouldBe(booked.Id);
            key.ExpiresAtUtc.ShouldBe(TestData.Now.AddHours(24));
        });
    }

    [Fact]
    public async Task Same_key_different_body_422_idempotency_key_reuse()
    {
        using var first = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten), "reused-key");
        first.StatusCode.ShouldBe(HttpStatusCode.Created);

        using var second = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten.AddHours(2)), "reused-key");

        var problem = await second.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "idempotency-key-reuse", Ct);
        problem.GetProperty("title").GetString().ShouldBe("Idempotency key reused");
        await _factory.WithDbAsync(async db => (await db.Appointments.CountAsync(Ct)).ShouldBe(1));
    }

    [Theory]
    [InlineData("has space")]
    [InlineData("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")]
    [InlineData("key=1")]
    public async Task Invalid_key_format_400(string key)
    {
        using var metrics = new MetricsCollector();

        using var response = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten), key);

        var problem = await response.ShouldBeValidationErrorAsync(["Idempotency-Key"], Ct);
        problem.GetProperty("errors").GetProperty("Idempotency-Key")[0].GetString().ShouldBe(
            "Idempotency-Key must be 1 to 64 characters: letters, digits, '-' and '_' (a UUID works).");
        await _factory.WithDbAsync(async db => (await db.Appointments.CountAsync(Ct)).ShouldBe(0));
        metrics.Sum("scheduler.booking.requests", MetricsCollector.Tag("outcome", "validation_failed")).ShouldBe(1, "a header rejection is a validation failure too");
        metrics.Of("scheduler.booking.duration").ShouldBeEmpty("the handler never ran");
    }

    [Fact]
    public async Task Two_key_headers_are_one_invalid_key_400()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Url(_workshop.Dealership.Id))
        {
            Content = System.Net.Http.Json.JsonContent.Create(TestData.BookingRequest(_workshop.Interim.Id, Ten), SchedulerJsonContext.Default.BookAppointmentRequest),
        };
        request.Headers.Add("Idempotency-Key", ["first", "second"]);

        using var response = await _client.SendAsync(request, Ct);

        await response.ShouldBeValidationErrorAsync(["Idempotency-Key"], Ct);
    }

    [Fact]
    public async Task Failed_booking_does_not_store_key()
    {
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1));
        await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 2));

        using var conflict = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 3), "after-409");
        conflict.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        await _factory.WithDbAsync(async db => (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0, "the 409 rolled back its key row"));

        using var retry = await PostAsync(_workshop.Dealership.Id, TestData.BookingRequest(_workshop.Interim.Id, Ten.AddHours(2), customerIndex: 3), "after-409");

        retry.StatusCode.ShouldBe(HttpStatusCode.Created, await retry.Content.ReadAsStringAsync(Ct));
        retry.Headers.Contains("Idempotent-Replayed").ShouldBeFalse();
    }

    [Fact]
    public async Task Expired_key_is_reused_for_a_new_booking()
    {
        var first = await BookAsync(TestData.BookingRequest(_workshop.Interim.Id, Ten, customerIndex: 1), "day-old-key");
        _factory.Clock.Advance(TimeSpan.FromHours(25));

        var later = TestData.BookingRequest(_workshop.Interim.Id, Ten.AddDays(1), customerIndex: 2);
        using var response = await PostAsync(_workshop.Dealership.Id, later, "day-old-key");

        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        response.Headers.Contains("Idempotent-Replayed").ShouldBeFalse();
        var second = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
        second.Id.ShouldNotBe(first.Id);
        await _factory.WithDbAsync(async db =>
        {
            var key = await db.IdempotencyKeys.AsNoTracking().SingleAsync(Ct);
            key.ResourceId.ShouldBe(second.Id);
            key.RequestFingerprint.ShouldBe(IdempotencyFingerprint.Compute(_workshop.Dealership.Id, later));
            key.ExpiresAtUtc.ShouldBe(TestData.Now.AddHours(25 + 24));
            (await db.Appointments.CountAsync(Ct)).ShouldBe(2);
        });
    }

    [Fact]
    public async Task Replay_answers_even_after_time_has_moved_past_the_rules()
    {
        var request = TestData.BookingRequest(_workshop.Interim.Id, TestData.Now.AddHours(2));
        var original = await BookAsync(request, "late-retry");
        _factory.Clock.SetUtcNow(TestData.DefaultNow.AddHours(2.5));

        using var retry = await PostAsync(_workshop.Dealership.Id, request, "late-retry");

        retry.StatusCode.ShouldBe(HttpStatusCode.Created, await retry.Content.ReadAsStringAsync(Ct));
        retry.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        (await retry.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct)).ShouldBe(original);
    }

    private static string Url(Guid dealershipId) => $"/api/v1/dealerships/{dealershipId}/appointments";

    private Task<HttpResponseMessage> PostAsync(Guid dealershipId, BookAppointmentRequest request, string? key, HttpClient? client = null) =>
        (client ?? _client).PostJsonAsync(
            Url(dealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest, key is null ? null : new Dictionary<string, string> { ["Idempotency-Key"] = key }, Ct);

    private async Task<AppointmentResponse> BookAsync(BookAppointmentRequest request, string? key = null)
    {
        using var response = await PostAsync(_workshop.Dealership.Id, request, key);
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync(Ct));
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
    }

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });

    /// <summary>Locks the dealership's row FOR UPDATE, which holds a booking there at its appointment INSERT (the foreign-key check).</summary>
    private async Task<LockHolder> HoldDealershipRowAsync(Guid dealershipId)
    {
        var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        var transaction = await connection.BeginTransactionAsync(Ct);
        await using var command = new NpgsqlCommand("SELECT id FROM dealerships WHERE id = @id FOR UPDATE", connection, transaction);
        command.Parameters.AddWithValue("id", dealershipId);
        await command.ExecuteNonQueryAsync(Ct);
        return new LockHolder(connection, transaction);
    }

    /// <summary>Takes the dealership's booking lock in a transaction of the test's own; committing (or disposing) releases it.</summary>
    private async Task<LockHolder> HoldDealershipLockAsync(Guid dealershipId)
    {
        var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        var transaction = await connection.BeginTransactionAsync(Ct);
        await using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, transaction);
        command.Parameters.AddWithValue("key", DealershipLock.KeyFor(dealershipId));
        await command.ExecuteNonQueryAsync(Ct);
        return new LockHolder(connection, transaction);
    }

    private sealed class LockHolder(NpgsqlConnection connection, NpgsqlTransaction transaction) : IAsyncDisposable
    {
        public Task CommitAsync(CancellationToken ct) => transaction.CommitAsync(ct);

        public async ValueTask DisposeAsync()
        {
            await transaction.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}

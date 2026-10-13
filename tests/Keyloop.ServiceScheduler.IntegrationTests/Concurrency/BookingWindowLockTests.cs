using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Concurrency;

public sealed class BookingWindowLockTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static DateTime Start => TestData.LondonTime(10);

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData(0, false)]
    [InlineData(0, true)]
    [InlineData(60, false)]
    [InlineData(60, true)]
    public async Task Lock_wait_crossing_start_or_lead_time_refuses_with_current_boundary_and_rolls_back(int leadMinutes, bool keyed)
    {
        _factory.Clock.SetUtcNow(new DateTimeOffset(Start.AddMinutes(-leadMinutes).AddSeconds(-10)));
        await using var host = _factory.WithWebHostBuilder(builder => builder.UseSetting("Scheduling:MinimumLeadTime", TimeSpan.FromMinutes(leadMinutes).ToString("c", System.Globalization.CultureInfo.InvariantCulture)));
        using var client = host.CreateClient();
        Task<HttpResponseMessage> pending;
        await using (var holder = await HoldLockAsync())
        {
            pending = PostAsync(client, keyed ? "window-key" : null);
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            pending.IsCompleted.ShouldBeFalse();
            _factory.Clock.Advance(TimeSpan.FromSeconds(20));
            await holder.CommitAsync(Ct);
        }
        using var refused = await pending.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        var problem = await refused.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "lead-time-not-met", Ct);
        problem.GetProperty("earliestStartUtc").GetDateTime().ShouldBe(Start.AddSeconds(10));
        await AssertRowsAsync(0);

        // A rejected keyed intention is not memoised, and its rollback releases the dealership lock.
        using var retry = await PostAsync(client, keyed ? "window-key" : null, Start.AddMinutes(15)).WaitAsync(TimeSpan.FromSeconds(20), Ct);
        retry.StatusCode.ShouldBe(HttpStatusCode.Created, await retry.Content.ReadAsStringAsync(Ct));
        await AssertRowsAsync(1, keyed ? 1 : 0);
    }

    [Fact]
    public async Task Clock_rewinding_during_lock_wait_rechecks_booking_horizon()
    {
        var clock = new CorrectableClock(new DateTimeOffset(Start.AddDays(-1).AddSeconds(10)));
        await using var host = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Scheduling:BookingHorizonDays", "1");
            builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(clock));
        });
        using var client = host.CreateClient();
        Task<HttpResponseMessage> pending;
        await using (var holder = await HoldLockAsync())
        {
            pending = PostAsync(client, "horizon-key");
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            clock.UtcNow = new DateTimeOffset(Start.AddDays(-1).AddSeconds(-10));
            await holder.CommitAsync(Ct);
        }
        using var refused = await pending.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        var problem = await refused.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "beyond-booking-horizon", Ct);
        problem.GetProperty("latestStartUtc").GetDateTime().ShouldBe(Start.AddSeconds(-10));
        await AssertRowsAsync(0);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(60)]
    public async Task Same_key_waiter_replays_committed_success_after_start_or_lead_time_boundary(int leadMinutes)
    {
        _factory.Clock.SetUtcNow(new DateTimeOffset(Start.AddMinutes(-leadMinutes).AddSeconds(-10)));
        var pause = new AfterBookingSavePause();
        await using var host = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Scheduling:MinimumLeadTime", TimeSpan.FromMinutes(leadMinutes).ToString("c", System.Globalization.CultureInfo.InvariantCulture));
            builder.ConfigureTestServices(services => services.AddDbContext<SchedulerDbContext>((_, options) => options.AddInterceptors(pause)));
        });
        using var client = host.CreateClient();
        pause.Arm();
        var first = PostAsync(client, "replay-window-key");
        Task<HttpResponseMessage>? waiter = null;
        try
        {
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(20), Ct);
            waiter = PostAsync(client, "replay-window-key");
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, 1, Ct);
            waiter.IsCompleted.ShouldBeFalse();
            _factory.Clock.Advance(TimeSpan.FromSeconds(20));
        }
        finally { pause.Release.TrySetResult(); }
        using var original = await first.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        using var replay = await waiter!.WaitAsync(TimeSpan.FromSeconds(20), Ct);
        original.StatusCode.ShouldBe(HttpStatusCode.Created);
        replay.StatusCode.ShouldBe(HttpStatusCode.Created, await replay.Content.ReadAsStringAsync(Ct));
        replay.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        replay.Headers.Location.ShouldBe(original.Headers.Location);
        (await replay.Content.ReadAsStringAsync(Ct)).ShouldBe(await original.Content.ReadAsStringAsync(Ct));
        using var sequentialReplay = await PostAsync(client, "replay-window-key");
        sequentialReplay.StatusCode.ShouldBe(HttpStatusCode.Created);
        sequentialReplay.Headers.GetValues("Idempotent-Replayed").ShouldBe(["true"]);
        await AssertRowsAsync(1, 1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Committed_id_recovery_precedes_window_recheck_after_lost_acknowledgement(bool keyed)
    {
        _factory.Clock.SetUtcNow(new DateTimeOffset(Start.AddSeconds(-10)));
        var loss = new CommitAcknowledgementLoss();
        var verification = new InconclusiveVerification
        {
            OnFired = _ =>
            {
                _factory.Clock.Advance(TimeSpan.FromSeconds(20));
                return Task.CompletedTask;
            },
        };
        await using var host = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddDbContext<SchedulerDbContext>((_, options) => options.AddInterceptors(loss, verification))));
        using var client = host.CreateClient();
        loss.Arm();
        verification.Arm();
        using var recovered = await PostAsync(client, keyed ? "lost-ack-window-key" : null).WaitAsync(TimeSpan.FromSeconds(30), Ct);
        recovered.StatusCode.ShouldBe(HttpStatusCode.Created, await recovered.Content.ReadAsStringAsync(Ct));
        loss.Fired.ShouldBe(1);
        verification.Fired.ShouldBe(1);
        _factory.Clock.GetUtcNow().UtcDateTime.ShouldBe(Start.AddSeconds(10));
        await AssertRowsAsync(1, keyed ? 1 : 0);
    }

    private async Task<LockHolder> HoldLockAsync()
    {
        var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        var transaction = await connection.BeginTransactionAsync(Ct);
        await using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, transaction);
        command.Parameters.AddWithValue("key", DealershipLock.KeyFor(_workshop.Dealership.Id));
        await command.ExecuteNonQueryAsync(Ct);
        return new LockHolder(connection, transaction);
    }

    private Task<HttpResponseMessage> PostAsync(HttpClient client, string? key, DateTime? start = null)
    {
        return client.PostJsonAsync($"/api/v1/dealerships/{_workshop.Dealership.Id}/appointments",
            TestData.BookingRequest(_workshop.Interim.Id, start ?? Start), SchedulerJsonContext.Default.BookAppointmentRequest,
            key is null ? null : new Dictionary<string, string> { ["Idempotency-Key"] = key }, Ct);
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

    // FakeTimeProvider intentionally refuses backward changes; this clock models an actual UTC clock correction.
    private sealed class CorrectableClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    private Task AssertRowsAsync(int count, int keys = 0) => _factory.WithDbAsync(async db =>
    {
        (await db.Appointments.CountAsync(Ct)).ShouldBe(count);
        (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(count);
        (await db.NotificationOutbox.CountAsync(Ct)).ShouldBe(count);
        (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(keys);
    });

    private sealed class AfterBookingSavePause : SaveChangesInterceptor
    {
        private int _armed;
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Arm() => Interlocked.Exchange(ref _armed, 1);
        public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref _armed, 0) == 1)
            {
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            }
            return result;
        }
    }
}

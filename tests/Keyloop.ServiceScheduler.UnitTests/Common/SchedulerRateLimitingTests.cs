using System.Net;
using System.Threading.RateLimiting;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

// The 429 response itself (problem body, Retry-After) is covered over HTTP by the integration suite's rate-limiting test.
public class SchedulerRateLimitingTests
{
    [Fact]
    public void Global_policy_partitions_by_client_ip_with_the_global_permits()
    {
        var partition = SchedulerRateLimiting.GlobalPartition(Request("/api/v1/dealerships", "203.0.113.7"), Settings(global: 2, booking: 50));

        partition.PartitionKey.ShouldBe("203.0.113.7");
        AcquiredOutOf(partition, attempts: 3).ShouldBe(2);
    }

    [Fact]
    public void Booking_policy_partitions_by_client_ip_with_the_booking_permits()
    {
        var partition = SchedulerRateLimiting.BookingPartition(Request("/api/v1/dealerships/x/appointments", "203.0.113.7"), Settings(global: 50, booking: 1));

        partition.PartitionKey.ShouldBe("203.0.113.7");
        AcquiredOutOf(partition, attempts: 3).ShouldBe(1);
    }

    [Fact]
    public void Rejected_lease_tells_the_client_when_to_retry()
    {
        var partition = SchedulerRateLimiting.GlobalPartition(Request("/api/v1/dealerships"), Settings(global: 1));
        using var limiter = partition.Factory(partition.PartitionKey);
        using var granted = limiter.AttemptAcquire();
        using var rejected = limiter.AttemptAcquire();

        rejected.IsAcquired.ShouldBeFalse();
        SchedulerRateLimiting.RetryAfter(rejected).ShouldBeInRange(TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1));
    }

    [Fact]
    public void Disabled_rate_limiting_never_rejects()
    {
        var settings = Settings(enabled: false, global: 1, booking: 1);

        AcquiredOutOf(SchedulerRateLimiting.GlobalPartition(Request("/api/v1/dealerships"), settings), attempts: 50).ShouldBe(50);
        AcquiredOutOf(SchedulerRateLimiting.BookingPartition(Request("/api/v1/dealerships/x/appointments"), settings), attempts: 50).ShouldBe(50);
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    public void Health_probes_are_never_limited(string path) =>
        AcquiredOutOf(SchedulerRateLimiting.GlobalPartition(Request(path), Settings(global: 1)), attempts: 50).ShouldBe(50);

    [Fact]
    public void Configured_global_limiter_exempts_health_probes_of_a_client_it_is_already_limiting()
    {
        // PartitionedRateLimiter caches limiters by partition key, so the exempt and limited partitions must not share one.
        var options = new RateLimiterOptions();
        SchedulerRateLimiting.Configure(options, Settings(global: 1));
        using var limiter = options.GlobalLimiter.ShouldNotBeNull();
        var api = Request("/api/v1/dealerships", "203.0.113.7");
        var health = Request("/alive", "203.0.113.7");

        using (var first = limiter.AttemptAcquire(api))
        using (var second = limiter.AttemptAcquire(api))
        {
            first.IsAcquired.ShouldBeTrue();
            second.IsAcquired.ShouldBeFalse();
        }

        for (var i = 0; i < 5; i++)
        {
            using var probe = limiter.AttemptAcquire(health);
            probe.IsAcquired.ShouldBeTrue();
        }

        // ... and a probe first does not exempt the client's API traffic either.
        var fresh = new RateLimiterOptions();
        SchedulerRateLimiting.Configure(fresh, Settings(global: 1));
        using var freshLimiter = fresh.GlobalLimiter.ShouldNotBeNull();
        using (freshLimiter.AttemptAcquire(Request("/health", "198.51.100.9")))
        using (var apiFirst = freshLimiter.AttemptAcquire(Request("/api/v1/dealerships", "198.51.100.9")))
        using (var apiSecond = freshLimiter.AttemptAcquire(Request("/api/v1/dealerships", "198.51.100.9")))
        {
            apiFirst.IsAcquired.ShouldBeTrue();
            apiSecond.IsAcquired.ShouldBeFalse();
        }
    }

    [Fact]
    public void Clients_without_a_remote_address_share_one_partition()
    {
        var http = new DefaultHttpContext();
        http.Request.Path = "/api/v1/dealerships";

        SchedulerRateLimiting.GlobalPartition(http, Settings()).PartitionKey.ShouldBe("unknown");
    }

    private static SecurityOptions.RateLimitingOptions Settings(bool enabled = true, int global = 300, int booking = 30) =>
        new() { Enabled = enabled, GlobalPermitsPerMinute = global, BookingPermitsPerMinute = booking };

    private static DefaultHttpContext Request(string path, string ip = "198.51.100.20")
    {
        var http = new DefaultHttpContext();
        http.Request.Path = path;
        http.Connection.RemoteIpAddress = IPAddress.Parse(ip);
        return http;
    }

    private static int AcquiredOutOf(RateLimitPartition<string> partition, int attempts)
    {
        using var limiter = partition.Factory(partition.PartitionKey);
        var acquired = 0;
        for (var i = 0; i < attempts; i++)
        {
            using var lease = limiter.AttemptAcquire();
            acquired += lease.IsAcquired ? 1 : 0;
        }

        return acquired;
    }
}

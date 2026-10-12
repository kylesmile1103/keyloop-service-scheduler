using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Keyloop.ServiceScheduler.Api.Common.Health;

/// <summary>Readiness requires a reachable database with every application migration applied (SYSTEM_DESIGN §12.3).</summary>
internal sealed class SchedulerReadinessCheck(IServiceScopeFactory scopes) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        // Health checks can run concurrently with requests and each other. Never share a request's context/change tracker.
        await using var scope = scopes.CreateAsyncScope();
        try
        {
            var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
            if (!await db.Database.CanConnectAsync(cancellationToken))
            {
                return HealthCheckResult.Unhealthy("The scheduler database is unavailable.");
            }

            var pending = await db.Database.GetPendingMigrationsAsync(cancellationToken);
            return pending.Any()
                ? HealthCheckResult.Unhealthy("The scheduler database has unapplied migrations.")
                : HealthCheckResult.Healthy();
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            return HealthCheckResult.Unhealthy("The scheduler database schema could not be verified.");
        }
    }
}

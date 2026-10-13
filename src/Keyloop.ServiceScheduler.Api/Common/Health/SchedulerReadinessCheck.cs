using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Keyloop.ServiceScheduler.Api.Common.Health;

/// <summary>Verifies that the database is reachable and all EF Core migrations have been applied.</summary>
internal sealed class SchedulerReadinessCheck(IServiceScopeFactory scopes) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
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

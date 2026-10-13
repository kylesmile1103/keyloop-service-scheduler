using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Checks on an independent connection whether each logged <c>1107 RequirementPolicyPublished</c> policy version is already committed.</summary>
public sealed class PolicyPublicationProbe(string connectionString) : ILoggerProvider
{
    private readonly string _connectionString = connectionString;
    private readonly List<(Guid DealershipId, int Version, int Previous, bool Committed)> _lines = [];

    public IReadOnlyList<(Guid DealershipId, int Version, int Previous, bool Committed)> Lines
    {
        get
        {
            lock (_lines)
            {
                return [.. _lines];
            }
        }
    }

    public ILogger CreateLogger(string categoryName) => new Probe(this);

    public void Dispose()
    {
    }

    /// <summary>Resets seeded requirement rules to v1 (without <c>hv-post-collision</c>) and removes <c>ACCIDENT-DAMAGE-ASSESSMENT</c> so the next seed publishes v2.</summary>
    public static async Task RevertToBeforeTask32aAsync(SchedulerDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        await db.RequirementRules.ExecuteDeleteAsync(ct);
        foreach (var site in new[] { ReferenceDataSeed.ReadingDealershipId, ReferenceDataSeed.MunichDealershipId })
        {
            db.RequirementRules.AddRange(RequirementRule.DefaultPolicy(site).Where(r => r.Code != RequirementRule.PostCollisionRuleCode)
                .Select(r => r with { Id = DeterministicGuid.Create($"requirement-rule:{site}:1:{r.Code}"), PolicyVersion = 1 }));
        }
        await db.SaveChangesAsync(ct);
        await db.ServiceTypes.Where(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT").ExecuteDeleteAsync(ct);
    }

    private sealed class Probe(PolicyPublicationProbe owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (eventId.Id != 1107 || state is not IReadOnlyList<KeyValuePair<string, object?>> values)
            {
                return;
            }

            var dealership = (Guid)values.Single(v => v.Key == "DealershipId").Value!;
            var version = (int)values.Single(v => v.Key == "PolicyVersion").Value!;
            var previous = (int)values.Single(v => v.Key == "PreviousVersion").Value!;
            using var connection = new NpgsqlConnection(owner._connectionString);
            connection.Open();
            using var command = new NpgsqlCommand(
                "SELECT count(*)::int FROM requirement_rules WHERE dealership_id = @dealership AND policy_version = @version", connection);
            command.Parameters.AddWithValue("dealership", dealership);
            command.Parameters.AddWithValue("version", version);
            var committed = (int)command.ExecuteScalar()! > 0;
            lock (owner._lines)
            {
                owner._lines.Add((dealership, version, previous, committed));
            }
        }
    }
}

using System.Data;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

public sealed class AdminPolicyHandler(SchedulerDbContext db, RequirementPolicyReader policies, AdminResourcesHandler resources, TimeProvider clock)
{
    public async Task<AdminPolicyResponse> GetAsync(Guid dealershipId, CancellationToken ct)
    {
        await resources.EnsureDealershipAsync(dealershipId, ct);
        return Response(dealershipId, await policies.ReadPolicyAsync(dealershipId, ct));
    }

    public async Task<PolicyEditResponse> WriteAsync(Guid dealershipId, PolicyWriteRequest request, string? ifMatch, CancellationToken ct)
    {
        var changeId = Guid.CreateVersion7(clock.GetUtcNow());
        PolicyEditResponse? pendingResult = null;
        var result = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            // The existing seeding lock is first and only: no dealership lock or resource update in this transaction.
            // It serializes version publication with both startup seed and demo reseed, retaining their existing lock order.
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await SeedingLock.AcquireAsync(db, ct);
            var completed = await db.AdminChanges.AsNoTracking().SingleOrDefaultAsync(a => a.Id == changeId, ct);
            if (completed is not null)
            {
                var saved = JsonSerializer.Deserialize(completed.After, SchedulerJsonContext.Default.AdminPolicyResponse)!;
                await transaction.RollbackAsync(ct);
                return pendingResult ?? new PolicyEditResponse(true, saved, request.PreviewDate, []);
            }
            var current = await GetAsync(dealershipId, ct);
            AdminPreconditions.Check(ifMatch, AdminPreconditions.PolicyTag(current.Version), current);
            var services = await db.ServiceTypes.AsNoTracking().OrderBy(s => s.Code).ToListAsync(ct);
            var codes = services.Select(s => s.Code).ToHashSet(StringComparer.Ordinal);
            for (var i = 0; i < request.Rules.Length; i++)
            {
                if (request.Rules[i].ServiceCodes.Any(code => !codes.Contains(code)))
                {
                    throw new AdminFieldException($"rules[{i}].serviceCodes", "Every service code must exist in the global catalogue.");
                }
            }
            var next = checked(current.Version + 1);
            var nextRules = Rules(dealershipId, next, request.Rules);
            var oldRules = Rules(dealershipId, current.Version, current.Rules);
            var roster = await new DayScheduleReader(db).ReadResourcesAsync(dealershipId, ct);
            var changes = new List<PolicyBookabilityChange>();
            foreach (var service in services)
            {
                foreach (var powertrain in Enum.GetValues<Powertrain>())
                {
                    foreach (var vehicleClass in Enum.GetValues<VehicleClass>())
                    {
                        foreach (var live in new[] { false, true })
                        {
                            var profile = VehicleProfile.Unknown with { Powertrain = powertrain, VehicleClass = vehicleClass };
                            var before = Bookable(RequirementResolver.Resolve(service, profile, oldRules, live, current.Version));
                            var after = Bookable(RequirementResolver.Resolve(service, profile, nextRules, live, next));
                            if (before != after)
                            {
                                changes.Add(new(service.Id, service.Code, powertrain, vehicleClass, live, before, after));
                            }
                        }
                    }
                }
            }
            var policy = new AdminPolicyResponse(dealershipId, next, request.Rules.OrderBy(r => r.Order).ThenBy(r => r.Code, StringComparer.Ordinal).ToArray());
            if (request.DryRun)
            {
                await transaction.RollbackAsync(ct);
                return new PolicyEditResponse(false, policy, request.PreviewDate, changes);
            }
            // Retain the effective default even on a previously unconfigured site, for older appointments and audit.
            if (!await db.RequirementRules.AnyAsync(r => r.DealershipId == dealershipId, ct)
                && !await db.RequirementPolicyVersions.AnyAsync(r => r.DealershipId == dealershipId, ct))
            {
                db.RequirementRules.AddRange(oldRules);
            }
            db.RequirementPolicyVersions.Add(new() { DealershipId = dealershipId, Version = next });
            db.RequirementRules.AddRange(nextRules);
            db.AdminChanges.Add(resources.Change(changeId, dealershipId, "policy", dealershipId, "publish",
                JsonSerializer.Serialize(current, SchedulerJsonContext.Default.AdminPolicyResponse),
                JsonSerializer.Serialize(policy, SchedulerJsonContext.Default.AdminPolicyResponse)));
            pendingResult = new PolicyEditResponse(true, policy, request.PreviewDate, changes);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return pendingResult;

            bool Bookable(JobRequirements requirements) => roster.Bays.Any(b => b.Satisfies(requirements))
                && roster.Technicians.Any(t => t.Satisfies(requirements, request.PreviewDate));
        });
        if (result.Saved) { AdminResourcesHandler.Count("policy", "publish"); }
        return result;
    }

    private static AdminPolicyResponse Response(Guid site, RequirementPolicySnapshot snapshot) => new(site, snapshot.Version,
        snapshot.Rules.Select(r => new RequirementRuleInput(r.Code, r.Order, r.Condition, r.Powertrains, r.ServiceCodes,
            r.VehicleClass, r.MinimumHvLevel, r.BayCapabilities, r.Certifications)).ToArray());

    private static RequirementRule[] Rules(Guid site, int version, IReadOnlyList<RequirementRuleInput> rules) => rules.Select(r => new RequirementRule
    {
        Id = Guid.NewGuid(), DealershipId = site, PolicyVersion = version, Code = r.Code, Order = r.Order, Condition = r.Condition,
        Powertrains = r.Powertrains, ServiceCodes = r.ServiceCodes, VehicleClass = r.VehicleClass, MinimumHvLevel = r.MinimumHvLevel,
        BayCapabilities = r.BayCapabilities, Certifications = r.Certifications,
    }).ToArray();
}

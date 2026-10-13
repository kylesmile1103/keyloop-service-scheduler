using System.Data;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

public sealed class AdminResourcesHandler(SchedulerDbContext db, CurrentActor actor, TimeProvider clock)
{
    public async Task EnsureDealershipAsync(Guid dealershipId, CancellationToken ct)
    {
        if (!await db.Dealerships.AnyAsync(d => d.Id == dealershipId, ct))
        {
            throw new NotFoundException(ProblemResources.Dealership, dealershipId);
        }
    }

    public async Task<IReadOnlyList<AdminTechnicianResponse>> ListTechniciansAsync(Guid dealershipId, CancellationToken ct)
    {
        await EnsureDealershipAsync(dealershipId, ct);
        return (await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId).OrderBy(t => t.Name).ThenBy(t => t.Id).ToListAsync(ct))
            .Select(AdminResourceMapper.ToResponse).ToArray();
    }

    public async Task<AdminTechnicianResponse> GetTechnicianAsync(Guid dealershipId, Guid technicianId, CancellationToken ct) =>
        AdminResourceMapper.ToResponse(await TechnicianAsync(dealershipId, technicianId, ct));

    public async Task<IReadOnlyList<AdminBayResponse>> ListBaysAsync(Guid dealershipId, CancellationToken ct)
    {
        await EnsureDealershipAsync(dealershipId, ct);
        return (await db.ServiceBays.AsNoTracking().Where(t => t.DealershipId == dealershipId).OrderBy(t => t.Name).ThenBy(t => t.Id).ToListAsync(ct))
            .Select(AdminResourceMapper.ToResponse).ToArray();
    }

    public async Task<AdminBayResponse> GetBayAsync(Guid dealershipId, Guid bayId, CancellationToken ct) =>
        AdminResourceMapper.ToResponse(await BayAsync(dealershipId, bayId, ct));

    public async Task<AdminTechnicianResponse> WriteTechnicianAsync(Guid dealershipId, Guid? technicianId, TechnicianWriteRequest? request,
        string? ifMatch, CancellationToken ct)
    {
        var id = technicianId ?? Guid.CreateVersion7(clock.GetUtcNow());
        var changeId = Guid.CreateVersion7(clock.GetUtcNow());
        var action = AdminVocabulary.Create;
        try
        {
            var response = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                // Qualification writes serialize with booking before reading the changed row or replay marker.
                // No seeding lock here; paths needing both always take seeding, then dealership.
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
                await DealershipLock.AcquireAsync(db, dealershipId, ct);
                if (await db.AdminChanges.AnyAsync(a => a.Id == changeId, ct))
                {
                    return await GetTechnicianAsync(dealershipId, id, ct);
                }
                await EnsureDealershipAsync(dealershipId, ct);
                Technician row;
                string? before = null;
                if (technicianId is not null)
                {
                    row = await TechnicianAsync(dealershipId, id, ct);
                    AdminPreconditions.Check(ifMatch, AdminPreconditions.ResourceTag(row.RowVersion), AdminResourceMapper.ToResponse(row));
                    before = JsonSerializer.Serialize(AdminResourceMapper.Snapshot(row), SchedulerJsonContext.Default.TechnicianWriteRequest);
                    action = request is null ? AdminVocabulary.ConfirmHv : row.IsActive != request.IsActive ? request.IsActive ? AdminVocabulary.Reactivate : AdminVocabulary.Deactivate : AdminVocabulary.Edit;
                    if (request is null)
                    {
                        row.ConfirmHvLevel();
                    }
                    else
                    {
                        row.Edit(request.Name, request.EmployeeNumber, request.Certifications, request.IsActive,
                            request.HvLevel, request.HvLevelValidUntil, request.HvLevelConfirmed, request.BrandSpecialisms);
                    }
                    // Even an identical edit is a conditional write, atomically advancing xmin with its audit.
                    db.Entry(row).Property(t => t.HvLevelConfirmed).IsModified = true;
                }
                else
                {
                    row = Technician.Create(id, dealershipId, request!.Name, request.EmployeeNumber, request.Certifications, request.IsActive,
                        request.HvLevel, request.HvLevelValidUntil, request.HvLevelConfirmed, request.BrandSpecialisms);
                    db.Technicians.Add(row);
                }
                db.AdminChanges.Add(Change(changeId, dealershipId, AdminVocabulary.Technician, id, action, before,
                    JsonSerializer.Serialize(AdminResourceMapper.Snapshot(row), SchedulerJsonContext.Default.TechnicianWriteRequest)));
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return AdminResourceMapper.ToResponse(row);
            });
            Count(AdminVocabulary.Technician, action);
            return response;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            var current = await GetTechnicianAsync(dealershipId, id, ct);
            if (await db.AdminChanges.AnyAsync(a => a.Id == changeId, ct)) { Count(AdminVocabulary.Technician, action); return current; }
            throw new AdminPreconditionException(412, AdminPreconditions.ResourceTag(current.Version), current);
        }
        catch (DbUpdateException ex) when (PostgresErrorClassifier.Classify(ex) == PostgresFailure.EmployeeNumberDuplicate)
        {
            throw new AdminFieldException("employeeNumber", "This employee number is already used at the dealership.");
        }
    }

    public async Task<AdminBayResponse> WriteBayAsync(Guid dealershipId, Guid? bayId, BayWriteRequest request, string? ifMatch, CancellationToken ct)
    {
        var id = bayId ?? Guid.CreateVersion7(clock.GetUtcNow());
        var changeId = Guid.CreateVersion7(clock.GetUtcNow());
        var action = AdminVocabulary.Create;
        try
        {
            var response = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                // Qualification writes serialize with booking before reading the changed row or replay marker.
                // No seeding lock here; paths needing both always take seeding, then dealership.
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
                await DealershipLock.AcquireAsync(db, dealershipId, ct);
                if (await db.AdminChanges.AnyAsync(a => a.Id == changeId, ct)) { return await GetBayAsync(dealershipId, id, ct); }
                await EnsureDealershipAsync(dealershipId, ct);
                ServiceBay row;
                string? before = null;
                if (bayId is not null)
                {
                    row = await BayAsync(dealershipId, id, ct);
                    AdminPreconditions.Check(ifMatch, AdminPreconditions.ResourceTag(row.RowVersion), AdminResourceMapper.ToResponse(row));
                    before = JsonSerializer.Serialize(AdminResourceMapper.Snapshot(row), SchedulerJsonContext.Default.BayWriteRequest);
                    action = row.IsActive != request.IsActive ? request.IsActive ? AdminVocabulary.Reactivate : AdminVocabulary.Deactivate : AdminVocabulary.Edit;
                    row.Edit(request.Name, request.Capabilities, request.IsActive);
                    db.Entry(row).Property(t => t.IsActive).IsModified = true;
                }
                else
                {
                    row = ServiceBay.Create(id, dealershipId, request.Name, request.Capabilities, request.IsActive);
                    db.ServiceBays.Add(row);
                }
                db.AdminChanges.Add(Change(changeId, dealershipId, AdminVocabulary.Bay, id, action, before,
                    JsonSerializer.Serialize(AdminResourceMapper.Snapshot(row), SchedulerJsonContext.Default.BayWriteRequest)));
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return AdminResourceMapper.ToResponse(row);
            });
            Count(AdminVocabulary.Bay, action);
            return response;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            var current = await GetBayAsync(dealershipId, id, ct);
            if (await db.AdminChanges.AnyAsync(a => a.Id == changeId, ct)) { Count(AdminVocabulary.Bay, action); return current; }
            throw new AdminPreconditionException(412, AdminPreconditions.ResourceTag(current.Version), current);
        }
    }

    public AdminChange Change(Guid changeId, Guid dealershipId, string kind, Guid id, string action, string? before, string after) => new()
    {
        Id = changeId, DealershipId = dealershipId, ResourceKind = kind, ResourceId = id, Action = action,
        Actor = actor.Name, AtUtc = clock.GetUtcNow().UtcDateTime, Before = before, After = after,
    };

    public static void Count(string kind, string action) => SchedulerTelemetry.AdminEdits.Add(1,
        new KeyValuePair<string, object?>("resource", kind), new KeyValuePair<string, object?>("action", action));

    private async Task<Technician> TechnicianAsync(Guid dealershipId, Guid id, CancellationToken ct) =>
        await db.Technicians.FirstOrDefaultAsync(t => t.Id == id && t.DealershipId == dealershipId, ct) ?? throw new NotFoundException("technician", id);
    private async Task<ServiceBay> BayAsync(Guid dealershipId, Guid id, CancellationToken ct) =>
        await db.ServiceBays.FirstOrDefaultAsync(t => t.Id == id && t.DealershipId == dealershipId, ct) ?? throw new NotFoundException("bay", id);
}

using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.History;

/// <summary>Bounded before/after reference snapshots; no visitor text. Resource history survives deactivation.</summary>
public sealed record AdminHistoryItem(Guid Id, string ResourceKind, Guid ResourceId, string Action, string Actor, DateTime AtUtc,
    JsonElement? Before, JsonElement After);

/// <summary>Newest first, stable ordering by timestamp and id; use nextOffset until null.</summary>
public sealed record AdminHistoryResponse(IReadOnlyList<AdminHistoryItem> Items, int? NextOffset);

public sealed class AdminHistoryHandler(SchedulerDbContext db, AdminResourcesHandler resources)
{
    public async Task<AdminHistoryResponse> ReadAsync(Guid site, string? resourceKind, Guid? resourceId, int? offset, int? limit, CancellationToken ct)
    {
        await resources.EnsureDealershipAsync(site, ct);
        if (resourceKind is not null && !AdminVocabulary.ResourceKinds.Contains(resourceKind))
        {
            throw new AdminFieldException("resourceKind", "Use technician, bay or policy.");
        }
        if (offset is < 0) { throw new AdminFieldException("offset", "Offset must be nonnegative."); }
        if (limit is < 1 or > 100) { throw new AdminFieldException("limit", "Limit must be between 1 and 100."); }
        var query = db.AdminChanges.AsNoTracking().Where(a => a.DealershipId == site);
        if (resourceKind is not null) { query = query.Where(a => a.ResourceKind == resourceKind); }
        if (resourceId.HasValue) { query = query.Where(a => a.ResourceId == resourceId); }
        var count = limit ?? 50;
        var start = offset ?? 0;
        var rows = await query.OrderByDescending(a => a.AtUtc).ThenByDescending(a => a.Id).Skip(start).Take(count + 1).ToListAsync(ct);
        return new(rows.Take(count).Select(a => new AdminHistoryItem(a.Id, a.ResourceKind, a.ResourceId, a.Action, a.Actor, a.AtUtc,
            a.Before is null ? null : Parse(a.Before), Parse(a.After))).ToArray(), rows.Count > count ? start + count : null);
    }

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

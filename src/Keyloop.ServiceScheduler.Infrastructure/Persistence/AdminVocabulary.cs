namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// The closed Admin audit vocabulary: <c>admin_changes.resource_kind</c> and <c>action</c>, the history filter and the
/// <c>scheduler.admin.edits</c> tags. The API contract enumerates exactly these lists (Api <c>SchedulerOpenApi</c>), so a new value is a
/// contract change. It lives beside <see cref="AdminChange"/> so the demo reseed recognises Admin-edited technicians by the same value.
/// </summary>
public static class AdminVocabulary
{
    public const string Technician = "technician";
    public const string Bay = "bay";
    public const string Policy = "policy";

    public const string Create = "create";
    public const string Edit = "edit";
    public const string Deactivate = "deactivate";
    public const string Reactivate = "reactivate";
    public const string ConfirmHv = "confirm-hv";
    public const string Publish = "publish";

    public static IReadOnlyList<string> ResourceKinds { get; } = [Technician, Bay, Policy];

    public static IReadOnlyList<string> Actions { get; } = [Create, Edit, Deactivate, Reactivate, ConfirmHv, Publish];
}

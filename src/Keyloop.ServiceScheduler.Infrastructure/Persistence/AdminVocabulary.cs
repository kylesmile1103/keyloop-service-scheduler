namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Closed Admin audit vocabulary for <c>admin_changes.resource_kind</c> and <c>action</c>, history filters, and metric tags.
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

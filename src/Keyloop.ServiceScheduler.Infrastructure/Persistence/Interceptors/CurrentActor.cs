namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Who is acting in the current DI scope, recorded on every audit row. Scoped; the Api's <c>CurrentActorMiddleware</c> sets
/// <c>user:&lt;verified email&gt;</c> for an authenticated request and <c>anonymous:&lt;ip&gt;</c> otherwise, and work outside a
/// request (startup seeding, tests) keeps <c>system</c>.
/// </summary>
public sealed class CurrentActor
{
    /// <summary>
    /// The audit column's width: <c>user:</c> plus a verified email of at most 254 characters (the RFC 5321 path limit the Api's
    /// authentication enforces), or <c>anonymous:</c> plus an IP address, with room to spare.
    /// </summary>
    public const int MaxLength = 300;

    public string Name { get; set; } = "system";
}

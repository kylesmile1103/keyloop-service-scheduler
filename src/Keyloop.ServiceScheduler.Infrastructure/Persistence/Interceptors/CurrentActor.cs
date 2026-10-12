namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;

/// <summary>
/// Who is acting in the current DI scope, recorded on every audit row. Scoped; <c>CurrentActorMiddleware</c> (Task 7) sets
/// <c>anonymous:&lt;ip&gt;</c> for HTTP requests, and work outside a request (startup seeding, tests) keeps <c>system</c>.
/// </summary>
public sealed class CurrentActor
{
    public string Name { get; set; } = "system";
}

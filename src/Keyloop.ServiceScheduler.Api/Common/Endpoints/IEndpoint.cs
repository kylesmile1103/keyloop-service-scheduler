namespace Keyloop.ServiceScheduler.Api.Common.Endpoints;

/// <summary>
/// The shape of a vertical slice's endpoint: one static <see cref="Map"/> that maps its route on the <c>/api/v1</c> group. Handlers
/// are <c>static</c> methods used as method groups, so the Request Delegate Generator compiles them and their XML comments reach the
/// OpenAPI document (Addendum B §B2). Implementations are listed in <see cref="EndpointRegistry"/>; nothing scans for them.
/// </summary>
public interface IEndpoint
{
    static abstract void Map(IEndpointRouteBuilder app);
}

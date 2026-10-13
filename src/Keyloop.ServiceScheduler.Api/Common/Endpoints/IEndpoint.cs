namespace Keyloop.ServiceScheduler.Api.Common.Endpoints;

/// <summary>Maps an API endpoint onto the <c>/api/v1</c> route group.</summary>
public interface IEndpoint
{
    static abstract void Map(IEndpointRouteBuilder app);
}

using Keyloop.ServiceScheduler.Api.Common.Problems;

namespace Keyloop.ServiceScheduler.Api.Common.Endpoints;

/// <summary>Every endpoint of the API, listed explicitly (ADR-016, Addendum A §A3): no assembly scanning or reflection-based discovery.</summary>
public static class EndpointRegistry
{
    public static IEndpointRouteBuilder MapSchedulerEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        var group = app.MapGroup("/api/v1").WithGroupName("v1");

        // Each slice adds its line here (Tasks 8–12), in API order.

        if (app.Environment.IsEnvironment("SystemTest"))
        {
            ProblemProbeEndpoint.Map(group);
        }

        return app;
    }
}

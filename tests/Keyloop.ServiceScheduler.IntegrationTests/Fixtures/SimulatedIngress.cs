using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Makes every request arrive from <paramref name="peer"/>, as if a TLS-terminating ingress at that address forwarded it. The test
/// server leaves the remote address null, and ForwardedHeadersMiddleware skips its known-proxy check for a null peer, so without
/// this a trust-boundary test would prove nothing.
/// </summary>
public sealed class SimulatedIngress(IPAddress peer) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use((context, nextMiddleware) =>
        {
            context.Connection.RemoteIpAddress = peer;
            return nextMiddleware(context);
        });
        next(app);
    };
}

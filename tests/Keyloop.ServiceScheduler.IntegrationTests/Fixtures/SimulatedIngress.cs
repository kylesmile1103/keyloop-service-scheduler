using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Sets <c>RemoteIpAddress</c> to <paramref name="peer"/> on every request to exercise forwarded-headers trust checks.</summary>
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

using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>Configures <see cref="ForwardedHeadersOptions"/> with the trusted proxies and networks from <see cref="SecurityOptions"/>.</summary>
public static class SchedulerForwardedHeaders
{
    public static IServiceCollection AddSchedulerForwardedHeaders(this IServiceCollection services)
    {
        services.AddOptions<ForwardedHeadersOptions>()
            .Configure<IOptions<SecurityOptions>>((options, security) => Configure(options, security.Value.ForwardedHeaders));
        return services;
    }

    internal static void Configure(ForwardedHeadersOptions options, SecurityOptions.ForwardedHeadersSettings settings)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1; // only the hop the ingress appended; anything earlier is client-supplied
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (var proxy in settings.KnownProxies)
        {
            options.KnownProxies.Add(IPAddress.Parse(proxy));
        }

        foreach (var network in settings.KnownNetworks)
        {
            options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        }
    }
}

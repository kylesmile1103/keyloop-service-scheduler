using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class ForwardedHeadersAndOpenApiTests
{
    [Fact]
    public void Forwarded_headers_trust_only_the_configured_proxies_and_networks()
    {
        var options = new ForwardedHeadersOptions(); // framework defaults trust loopback
        SchedulerForwardedHeaders.Configure(options, new SecurityOptions.ForwardedHeadersSettings
        {
            Enabled = true,
            KnownProxies = ["10.1.2.3"],
            KnownNetworks = ["172.16.0.0/12"],
        });

        options.ForwardedHeaders.ShouldBe(ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
        options.ForwardLimit.ShouldBe(1);
        options.KnownProxies.ShouldBe([IPAddress.Parse("10.1.2.3")]);
        options.KnownIPNetworks.ShouldBe([System.Net.IPNetwork.Parse("172.16.0.0/12")]);
    }

    [Fact]
    public async Task Document_tags_follow_the_fixed_order_with_extras_last()
    {
        var document = new OpenApiDocument
        {
            Tags = new HashSet<OpenApiTag> { new() { Name = "Zeta" }, new() { Name = ApiTags.Schedule }, new() { Name = ApiTags.Dealerships }, new() { Name = "Alpha" } },
        };
        using var services = new ServiceCollection().BuildServiceProvider();
        var context = new OpenApiDocumentTransformerContext { DocumentName = "v1", DescriptionGroups = [], ApplicationServices = services };

        await SchedulerOpenApi.TransformDocument(document, context, CancellationToken.None);

        document.Tags.ShouldNotBeNull().Select(tag => tag.Name)
            .ShouldBe([ApiTags.Dealerships, ApiTags.Catalog, ApiTags.Availability, ApiTags.Appointments, "Identity", ApiTags.Schedule, ApiTags.Features, ApiTags.Admin, "Alpha", "Zeta"]);
        document.Tags.Take(5).ShouldAllBe(tag => !string.IsNullOrWhiteSpace(tag.Description));
    }
}

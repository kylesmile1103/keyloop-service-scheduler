using System.Net;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Microsoft.AspNetCore.Http;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class CurrentActorMiddlewareTests
{
    [Fact]
    public async Task Request_actor_is_anonymous_with_the_client_ip()
    {
        var actor = new CurrentActor();
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.7");
        var nextCalled = false;

        await new CurrentActorMiddleware(actor).InvokeAsync(http, _ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        actor.Name.ShouldBe("anonymous:203.0.113.7");
        nextCalled.ShouldBeTrue();
    }

    [Fact]
    public async Task Request_without_a_remote_address_is_anonymous_unknown()
    {
        var actor = new CurrentActor();

        await new CurrentActorMiddleware(actor).InvokeAsync(new DefaultHttpContext(), _ => Task.CompletedTask);

        actor.Name.ShouldBe("anonymous:unknown");
    }
}

using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

/// <summary>
/// The registered fallback policy, evaluated as the authorization middleware does (the HttpContext is the resource). A mapped route
/// that declares neither a policy nor AllowAnonymous is Admin-only; requests that matched no route keep routing's own 404/405.
/// </summary>
public sealed class FallbackPolicyTests : IDisposable
{
    private readonly ServiceProvider _services;

    public FallbackPolicyTests()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddSchedulerAuthentication(new Environment());
        _services = services.BuildServiceProvider();
    }

    public void Dispose() => _services.Dispose();

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData(SchedulerRoles.Viewer, false)]
    [InlineData(SchedulerRoles.ServiceAdvisor, false)]
    [InlineData(SchedulerRoles.Admin, true)]
    public async Task A_mapped_route_without_declared_access_is_Admin_only(string? role, bool allowed)
    {
        var http = new DefaultHttpContext();
        http.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse("/api/v1/unclassified"), 0, EndpointMetadataCollection.Empty, "unclassified"));

        (await AuthorizeAsync(http, role)).ShouldBe(allowed);
    }

    [Fact]
    public async Task Unmatched_requests_and_the_405_rejection_endpoint_are_left_to_routing()
    {
        var unmatched = new DefaultHttpContext();
        (await AuthorizeAsync(unmatched, null)).ShouldBeTrue("an unknown path stays a 404 for anonymous callers");

        var rejection = new DefaultHttpContext();
        rejection.SetEndpoint(new Endpoint(_ => Task.CompletedTask, EndpointMetadataCollection.Empty, "405 HTTP Method Not Supported"));
        (await AuthorizeAsync(rejection, null)).ShouldBeTrue("a wrong method on a mapped path stays a 405");
    }

    private async Task<bool> AuthorizeAsync(HttpContext http, string? role)
    {
        var policy = (await _services.GetRequiredService<IAuthorizationPolicyProvider>().GetFallbackPolicyAsync()).ShouldNotBeNull();
        var identity = role is null ? new ClaimsIdentity() : new ClaimsIdentity([new Claim(ClaimTypes.Email, "caller@keyloop.test")], "Test");
        if (!string.IsNullOrEmpty(role))
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }

        var result = await _services.GetRequiredService<IAuthorizationService>().AuthorizeAsync(new ClaimsPrincipal(identity), http, policy);
        return result.Succeeded;
    }

    private sealed class Environment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "SystemTest";
        public string ApplicationName { get; set; } = "Keyloop.ServiceScheduler.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}

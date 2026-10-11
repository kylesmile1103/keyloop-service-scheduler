using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Testing;

namespace Keyloop.ServiceScheduler.AspireTests;

[Trait("Category", "Aspire")]
public sealed class AppHostModelTests
{
    [Fact]
    public async Task Published_api_uses_Demo_and_the_root_Dockerfile_context_with_an_initialized_database()
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
            ["--operation=publish"], timeout.Token);
        builder.ExecutionContext.IsPublishMode.ShouldBeTrue();
        var postgres = builder.Resources.OfType<ContainerResource>().Single(r => r.Name == "postgres");
        var databaseEnvironment = await EnvironmentAsync(builder, postgres, timeout.Token);
        databaseEnvironment["POSTGRES_DB"].ShouldBe("schedulerdb");

        var api = builder.Resources.OfType<ContainerResource>().Single(r => r.Name == "api");
        var environment = await EnvironmentAsync(builder, api, timeout.Token);
        environment["ASPNETCORE_ENVIRONMENT"].ShouldBe("Demo");
        environment["DOTNET_ENVIRONMENT"].ShouldBe("Demo");
        environment.ShouldNotContainKey("ASPNETCORE_FORWARDEDHEADERS_ENABLED");
        api.Annotations.OfType<DisableForwardedHeadersAnnotation>().ShouldHaveSingleItem();
        api.Annotations.OfType<EndpointAnnotation>().Single(e => e.Name == "http").TargetPort.ShouldBe(8080);

        var dockerfile = api.Annotations.OfType<DockerfileBuildAnnotation>().Last();
        var repositoryRoot = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "../.."));
        Path.GetFullPath(dockerfile.ContextPath).ShouldBe(repositoryRoot);
        Path.GetFullPath(dockerfile.DockerfilePath, dockerfile.ContextPath)
            .ShouldBe(Path.Combine(repositoryRoot, "src/Keyloop.ServiceScheduler.Api/Dockerfile"));
    }

    [Fact]
    public async Task Api_leaves_forwarded_header_trust_to_its_validated_security_options()
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(timeout.Token);
        var api = builder.Resources.OfType<ProjectResource>().Single(r => r.Name == "api");

        api.Annotations.OfType<DisableForwardedHeadersAnnotation>().ShouldHaveSingleItem();
        api.Annotations.OfType<HealthCheckAnnotation>().Select(h => h.Key).ShouldContain("api_http_/health_200_check");
    }

    private static async Task<Dictionary<string, object>> EnvironmentAsync(IDistributedApplicationTestingBuilder builder, IResource resource, CancellationToken ct)
    {
        var environment = new Dictionary<string, object>();
        var context = new EnvironmentCallbackContext(builder.ExecutionContext, resource, environment, ct);
        foreach (var annotation in resource.Annotations.OfType<EnvironmentCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }
        return environment;
    }
}

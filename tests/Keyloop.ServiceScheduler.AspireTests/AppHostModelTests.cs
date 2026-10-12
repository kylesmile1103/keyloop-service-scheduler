using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Testing;
using Microsoft.Extensions.Configuration;

namespace Keyloop.ServiceScheduler.AspireTests;

[Trait("Category", "Aspire")]
public sealed class AppHostModelTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Triage_parameters_are_optional_and_only_wired_when_both_are_supplied(bool enabled)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        var arguments = enabled
            ? new[] { "--Parameters:cloudflare-account-id=00000000000000000000000000000000", "--Parameters:cloudflare-ai-token=test-token" }
            : new[] { "--Parameters:cloudflare-account-id=", "--Parameters:cloudflare-ai-token=" };
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(arguments, timeout.Token);
        var api = builder.Resources.OfType<ProjectResource>().Single(r => r.Name == "api");
        var environment = await EnvironmentAsync(builder, api, timeout.Token);
        environment.ContainsKey("Triage__Enabled").ShouldBe(enabled);
        environment.ContainsKey("Triage__ApiToken").ShouldBe(enabled);
        environment.ContainsKey("Triage__AccountId").ShouldBe(enabled);
        if (enabled)
        {
            environment["Triage__Enabled"].ShouldBe("true");
            builder.Resources.OfType<ParameterResource>().Single(p => p.Name == "cloudflare-ai-token").Secret.ShouldBeTrue();
        }
    }

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
    public async Task Published_bundle_starts_as_scheduler_with_only_the_documented_inputs()
    {
        using var bundle = await PublishedBundle.CreateAsync(TestContext.Current.CancellationToken);

        // The documented manual start: generated .env plus both image inputs and POSTGRES_PASSWORD. POSTGRES_USER stays empty.
        using var compose = await bundle.ResolveAsync(
            DocumentedInputs,
            TestContext.Current.CancellationToken);

        var services = compose.RootElement.GetProperty("services");
        services.GetProperty("postgres").GetProperty("environment").GetProperty("POSTGRES_USER").GetString().ShouldBe("scheduler");
        var api = services.GetProperty("api").GetProperty("environment");
        api.GetProperty("ConnectionStrings__schedulerdb").GetString().ShouldNotBeNull().ShouldContain("Username=scheduler;");
        api.GetProperty("SCHEDULERDB_USERNAME").GetString().ShouldBe("scheduler");

        var web = services.GetProperty("web");
        web.GetProperty("image").GetString().ShouldBe(DocumentedInputs["WEB_IMAGE"]);
        var webEnvironment = web.GetProperty("environment");
        webEnvironment.GetProperty("API_UPSTREAM").GetString().ShouldBe($"http://api:{api.GetProperty("HTTP_PORTS").GetString()}");
        webEnvironment.GetProperty("PORT").GetString().ShouldBe("8080");
        web.GetProperty("ports").EnumerateArray().ShouldHaveSingleItem().GetProperty("target").GetInt32().ShouldBe(8080);
        web.GetProperty("networks").EnumerateObject().Select(n => n.Name).ShouldBe(["aspire"]);
    }

    [Fact]
    public async Task Published_web_uses_its_committed_Dockerfile_and_the_api_endpoint_reference()
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
            ["--operation=publish"], timeout.Token);
        var web = builder.Resources.OfType<ContainerResource>().Single(r => r.Name == "web");
        var environment = await EnvironmentAsync(builder, web, timeout.Token);
        var upstream = environment["API_UPSTREAM"].ShouldBeOfType<EndpointReference>();
        upstream.Resource.Name.ShouldBe("api");
        upstream.EndpointName.ShouldBe("http");
        web.Annotations.OfType<EndpointAnnotation>().ShouldHaveSingleItem().TargetPort.ShouldBe(8080);

        var dockerfile = web.Annotations.OfType<DockerfileBuildAnnotation>().Last();
        var webDirectory = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "../Keyloop.ServiceScheduler.Web"));
        Path.GetFullPath(dockerfile.ContextPath).ShouldBe(webDirectory);
        Path.GetFullPath(dockerfile.DockerfilePath, dockerfile.ContextPath).ShouldBe(Path.Combine(webDirectory, "Dockerfile"));
    }

    [Fact]
    public async Task Published_network_is_exactly_what_Demo_trusts_and_the_api_stays_unpublished_on_it()
    {
        using var bundle = await PublishedBundle.CreateAsync(TestContext.Current.CancellationToken);
        using var compose = await bundle.ResolveAsync(
            DocumentedInputs,
            TestContext.Current.CancellationToken);

        // The API's effective Demo settings, merged the way the API merges them.
        var trust = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(bundle.RepositoryRoot, "src/Keyloop.ServiceScheduler.Api/appsettings.json"), optional: false, reloadOnChange: false)
            .AddJsonFile(Path.Combine(bundle.RepositoryRoot, "src/Keyloop.ServiceScheduler.Api/appsettings.Demo.json"), optional: false, reloadOnChange: false)
            .Build()
            .GetSection("Security:ForwardedHeaders");
        trust.GetSection("KnownProxies").GetChildren().ShouldBeEmpty();
        var trustedNetworks = trust.GetSection("KnownNetworks").GetChildren().Select(n => n.Value).ToList();

        var subnets = compose.RootElement.GetProperty("networks").GetProperty("aspire").GetProperty("ipam").GetProperty("config")
            .EnumerateArray().Select(c => c.GetProperty("subnet").GetString()).ToList();
        subnets.ShouldNotBeEmpty();
        trustedNetworks.ShouldBe(subnets);

        // The trusted network contains the bridge gateway, through which Docker delivers traffic from published host ports. Publishing the
        // API's port would therefore let any host client spoof X-Forwarded-For (rate-limit partition, audit actor); only expose is allowed.
        var apiService = compose.RootElement.GetProperty("services").GetProperty("api");
        apiService.TryGetProperty("ports", out _).ShouldBeFalse();
        apiService.GetProperty("networks").EnumerateObject().Select(n => n.Name).ShouldBe(["aspire"]);
    }

    private static readonly IReadOnlyDictionary<string, string> DocumentedInputs = new Dictionary<string, string>
    {
        ["API_IMAGE"] = "keyloop-scheduler-api:model-test",
        ["WEB_IMAGE"] = "keyloop-scheduler-web:model-test",
        ["POSTGRES_PASSWORD"] = "model-test-password",
    };

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

    /// <summary>
    /// A real <c>aspire publish</c> of the AppHost (the CLI runs the same pipeline step) into a temporary directory, resolved by
    /// <c>docker compose config</c> exactly as an operator's <c>docker compose up</c> would resolve it.
    /// </summary>
    private sealed class PublishedBundle : IDisposable
    {
        private PublishedBundle(string directory, string repositoryRoot) => (Directory, RepositoryRoot) = (directory, repositoryRoot);

        public string Directory { get; }

        public string RepositoryRoot { get; }

        public static async Task<PublishedBundle> CreateAsync(CancellationToken ct)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(60));
            var output = System.IO.Directory.CreateTempSubdirectory("keyloop-compose-");
            try
            {
                // The password is supplied so that nothing evaluates, and so persists, its generated default.
                var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
                var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
                    ["--operation", "publish", "--step", "publish", "--output-path", output.FullName, $"--Parameters:postgres-password={password}"],
                    timeout.Token);
                var repositoryRoot = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "../.."));
                await using (var app = await builder.BuildAsync(timeout.Token))
                {
                    await app.RunAsync(timeout.Token); // publish mode: runs the pipeline step, then stops the application
                }

                File.Exists(Path.Combine(output.FullName, "docker-compose.yaml")).ShouldBeTrue("the publish pipeline wrote no Compose file");
                File.Exists(Path.Combine(output.FullName, ".env")).ShouldBeTrue("the publish pipeline wrote no .env file");
                return new PublishedBundle(output.FullName, repositoryRoot);
            }
            catch
            {
                output.Delete(recursive: true);
                throw;
            }
        }

        /// <summary>
        /// <c>docker compose config</c> over the generated files with the generated <c>.env</c> and only <paramref name="inputs"/>: every
        /// variable the <c>.env</c> declares is removed from the inherited environment first, so nothing from the caller's shell leaks in.
        /// </summary>
        public async Task<JsonDocument> ResolveAsync(IReadOnlyDictionary<string, string> inputs, CancellationToken ct)
        {
            var envFile = Path.Combine(Directory, ".env");
            var start = new ProcessStartInfo("docker") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var argument in new[]
            {
                "compose", "--project-name", "keyloop-publish-model", "--env-file", envFile,
                "-f", Path.Combine(Directory, "docker-compose.yaml"), "config", "--format", "json",
            })
            {
                start.ArgumentList.Add(argument);
            }

            foreach (var line in await File.ReadAllLinesAsync(envFile, ct))
            {
                var separator = line.IndexOf('=', StringComparison.Ordinal);
                if (!line.StartsWith('#') && separator > 0)
                {
                    start.Environment.Remove(line[..separator].Trim());
                }
            }

            foreach (var (name, value) in inputs)
            {
                start.Environment[name] = value;
            }

            using var process = Process.Start(start).ShouldNotBeNull();
            var output = process.StandardOutput.ReadToEndAsync(ct);
            var error = process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            process.ExitCode.ShouldBe(0, $"docker compose config failed: {await error}");
            return JsonDocument.Parse(await output);
        }

        public void Dispose() => System.IO.Directory.Delete(Directory, recursive: true);
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

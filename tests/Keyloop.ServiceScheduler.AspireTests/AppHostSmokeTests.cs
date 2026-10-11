using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Postgres;
using Aspire.Hosting.Testing;

namespace Keyloop.ServiceScheduler.AspireTests;

/// <summary>
/// The composed application (Addendum C §C7, SYSTEM_DESIGN §14.3, ADR-013): the AppHost itself, booted by Aspire.Hosting.Testing, with
/// PostgreSQL from its parameters, the API migrating and seeding in Development behind its health check, the dashboard's Scalar link
/// and the <em>Reseed demo data</em> command. Category <c>Aspire</c>: it needs Docker and takes about half a minute; CI runs it in its
/// own step. Only one AppHost may run on a machine at a time. It lives in this project rather than the integration tests because
/// Aspire.Hosting needs reflection-based JSON, which the integration test process disables to mirror the API (ADR-016).
/// </summary>
/// <remarks>
/// Two things are made hermetic, and only for the test. The database password is supplied (as <c>Parameters:postgres-password</c>), so the
/// persisted password default is never evaluated or written (configuration can still load user secrets). PostgreSQL and pgweb run with session lifetimes and without the named
/// data volume, so the run leaves no container or volume behind and never touches the developer's persistent database. Everything else is
/// the AppHost model, with testing's random ports and disabled dashboard; <see cref="Development_database_is_persistent_with_generated_secret_credentials"/>
/// pins the persistence the run takes away.
/// </remarks>
[Trait("Category", "Aspire")]
public sealed class AppHostSmokeTests(AppHostSmokeTests.RunningAppHost appHost) : IClassFixture<AppHostSmokeTests.RunningAppHost>
{
    private const string ReseedCommand = "reseed-demo-data";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Api_is_healthy_on_the_composed_database_and_serves_the_seeded_dealerships()
    {
        using var http = appHost.App.CreateHttpClient("api", "http");

        using var response = await http.GetAsync("/api/v1/dealerships", Ct);

        var body = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        using var dealerships = JsonDocument.Parse(body);
        dealerships.RootElement.EnumerateArray().Select(d => d.GetProperty("name").GetString())
            .ShouldBe(["Keyloop Autohaus München", "Keyloop Motors Reading"], "the two seeded dealerships, by name");
    }

    [Fact]
    public void Dashboard_links_the_api_to_its_Scalar_reference()
    {
        appHost.App.ResourceNotifications.TryGetCurrentState("api", out var api).ShouldBeTrue();

        var scalar = api!.Snapshot.Urls.Where(u => u.DisplayProperties.DisplayName == "Scalar API reference").ShouldHaveSingleItem();
        new Uri(scalar.Url).AbsolutePath.ShouldBe("/scalar/v1");
        new Uri(scalar.Url).Scheme.ShouldBe("https");
    }

    [Theory]
    [InlineData("https", new[] { "https", "http" })]
    [InlineData("http", new[] { "http" })]
    public async Task Dashboard_links_Scalar_from_whichever_endpoint_the_launch_profile_gives_the_api(string launchProfile, string[] endpoints)
    {
        // The AppHost's launch profile picks the API's (DOTNET_LAUNCH_PROFILE): `https` gives it both endpoints, `http` plain HTTP only.
        // The model only, nothing is started: the URL callbacks run as the orchestrator runs them, over one URL per endpoint.
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
            [$"--DOTNET_LAUNCH_PROFILE={launchProfile}"], Ct);
        var api = builder.Resources.OfType<ProjectResource>().Single(resource => resource.Name == "api");
        api.Annotations.OfType<EndpointAnnotation>().Select(endpoint => endpoint.Name).ShouldBe(endpoints, ignoreOrder: true);
        var context = new ResourceUrlsCallbackContext(
            builder.ExecutionContext,
            api,
            [.. endpoints.Select(name => new ResourceUrlAnnotation { Url = $"{name}://localhost", Endpoint = new EndpointReference(api, name) })],
            Ct);

        foreach (var annotation in api.Annotations.OfType<ResourceUrlsCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }

        // Preferably on https; a link on an endpoint the api does not have would be dropped.
        var scalar = context.Urls.Where(url => url.DisplayText == "Scalar API reference").ShouldHaveSingleItem();
        (scalar.Url, scalar.Endpoint?.EndpointName).ShouldBe(("/scalar/v1", endpoints[0]));
        context.Urls.Where(url => url != scalar).Select(url => url.DisplayText).ShouldBe(endpoints.Select(name => $"API ({name})"));
    }

    [Fact]
    public async Task Reseed_demo_data_command_reseeds_through_the_key_protected_route()
    {
        appHost.App.ResourceNotifications.TryGetCurrentState("api", out var api).ShouldBeTrue();
        var command = api!.Snapshot.Commands.Where(c => c.Name == ReseedCommand).ShouldHaveSingleItem();
        command.DisplayName.ShouldBe("Reseed demo data");
        command.ConfirmationMessage.ShouldNotBeNullOrWhiteSpace("the command deletes data, so the dashboard asks first");

        var result = await appHost.App.ResourceCommands.ExecuteCommandAsync("api", ReseedCommand, Ct);

        result.Success.ShouldBeTrue(result.Message);
        using (var outcome = JsonDocument.Parse(result.Data.ShouldNotBeNull("the command shows the API's answer").Value))
        {
            // Any seven days from now hold open days at Reading, so the demo week is never empty.
            outcome.RootElement.GetProperty("appointmentsCreated").GetInt32().ShouldBeGreaterThan(0);
        }

        // Only the command knows the key: the same request without it is answered like an unknown route.
        using var http = appHost.App.CreateHttpClient("api", "http");
        using var withoutKey = await http.PostAsync("/api/v1/admin/demo/reseed", content: null, Ct);
        withoutKey.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Development_database_is_persistent_with_generated_secret_credentials()
    {
        // The model only: nothing is started, and no parameter value is read (reading the password would generate and persist one).
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(Ct);

        var postgres = builder.Resources.OfType<PostgresServerResource>().ShouldHaveSingleItem();
        postgres.Annotations.OfType<ContainerImageAnnotation>().Last().Tag.ShouldBe("17");
        postgres.Annotations.OfType<ContainerLifetimeAnnotation>().Last().Lifetime.ShouldBe(ContainerLifetime.Persistent);
        var volume = postgres.Annotations.OfType<ContainerMountAnnotation>().ShouldHaveSingleItem();
        (volume.Type, volume.Source, volume.Target).ShouldBe((ContainerMountType.Volume, "keyloop-scheduler-pgdata", "/var/lib/postgresql/data"));

        // Generated on the first run and kept in the AppHost's user secrets (Addendum C §C1): never typed, never in a settings file.
        postgres.PasswordParameter.Name.ShouldBe("postgres-password");
        postgres.PasswordParameter.Secret.ShouldBeTrue();
        postgres.PasswordParameter.Default.ShouldNotBeNull().GetType().Name.ShouldBe("UserSecretsParameterDefault");
        postgres.UserNameParameter.ShouldNotBeNull().Name.ShouldBe("postgres-user");

        builder.Resources.OfType<PgWebContainerResource>().ShouldHaveSingleItem()
            .Annotations.OfType<ContainerLifetimeAnnotation>().Last().Lifetime.ShouldBe(ContainerLifetime.Persistent);
    }

    /// <summary>The AppHost, started once for the class and stopped (with its containers removed) after it.</summary>
    public sealed class RunningAppHost : IAsyncLifetime
    {
        private static readonly TimeSpan StartupTimeout = TimeSpan.FromMinutes(5);

        public DistributedApplication App { get; private set; } = null!;

        public async ValueTask InitializeAsync()
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            timeout.CancelAfter(StartupTimeout);
            var ct = timeout.Token;
            var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
                [$"--Parameters:postgres-password={password}"], ct);
            try
            {
                foreach (var container in builder.Resources.OfType<ContainerResource>().ToList())
                {
                    builder.CreateResourceBuilder(container).WithLifetime(ContainerLifetime.Session);
                    foreach (var volume in container.Annotations.OfType<ContainerMountAnnotation>().Where(m => m.Type == ContainerMountType.Volume).ToList())
                    {
                        container.Annotations.Remove(volume);
                    }
                }

                App = await builder.BuildAsync(ct);
                await App.StartAsync(ct);
                await App.ResourceNotifications.WaitForResourceHealthyAsync("api", ct);
            }
            catch
            {
                if (App is not null)
                {
                    await DisposeAsync();
                }
                else
                {
                    await builder.DisposeAsync();
                }
                throw;
            }
        }

        public async ValueTask DisposeAsync()
        {
            if (App is not null)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try
                {
                    await App.StopAsync(timeout.Token);
                }
                finally
                {
                    await App.DisposeAsync();
                    App = null!;
                }
            }
        }
    }
}

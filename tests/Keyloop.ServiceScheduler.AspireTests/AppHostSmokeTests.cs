using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Postgres;
using Aspire.Hosting.Testing;

namespace Keyloop.ServiceScheduler.AspireTests;

/// <summary>End-to-end smoke tests for the composed AppHost with hermetic session-scoped containers.</summary>
[Trait("Category", "Aspire")]
public sealed class AppHostSmokeTests(AppHostSmokeTests.RunningAppHost appHost) : IClassFixture<AppHostSmokeTests.RunningAppHost>
{
    private const string ReseedCommand = "reseed-demo-data";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Api_starts_with_the_default_Development_Admin_without_auth_parameters()
    {
        using var http = appHost.App.CreateHttpClient("api", "http");
        using var response = await http.GetAsync("/api/v1/me", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        body.RootElement.GetProperty("authenticated").GetBoolean().ShouldBeTrue();
        body.RootElement.GetProperty("email").GetString().ShouldBe("admin@keyloop.test");
        body.RootElement.GetProperty("roles").EnumerateArray().Select(role => role.GetString()).ShouldBe(["Admin"]);
    }

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
    public async Task Web_proxies_the_seeded_dealerships_as_JSON_through_api_discovery()
    {
        using var http = appHost.App.CreateHttpClient("web", "http");
        using var response = await http.GetAsync("/api/v1/dealerships", Ct);

        var body = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        response.Content.Headers.ContentType.ShouldNotBeNull().MediaType.ShouldBe("application/json");
        using var dealerships = JsonDocument.Parse(body);
        dealerships.RootElement.EnumerateArray().Select(d => d.GetProperty("name").GetString())
            .ShouldBe(["Keyloop Autohaus München", "Keyloop Motors Reading"], "the web proxy must reach the seeded API, not serve the SPA");
    }

    [Fact]
    public void Dashboard_links_the_api_to_its_Scalar_reference()
    {
        appHost.App.ResourceNotifications.TryGetCurrentState("api", out var api).ShouldBeTrue();

        var scalar = api!.Snapshot.Urls.Where(u => u.DisplayProperties.DisplayName == "Scalar API reference").ShouldHaveSingleItem();
        new Uri(scalar.Url).AbsolutePath.ShouldBe("/scalar/v1");
        new Uri(scalar.Url).Scheme.ShouldBe("https");
    }

    [Fact]
    public void Dashboard_runs_on_a_dev_localhost_name()
    {
        new Uri(RunningAppHost.LaunchProfileDashboardUrl()).Host.ShouldBe("scheduler.dev.localhost");
    }

    [Theory]
    [InlineData("https", new[] { "https", "http" })]
    [InlineData("http", new[] { "http" })]
    public async Task Dashboard_links_Scalar_from_whichever_endpoint_the_launch_profile_gives_the_api(string launchProfile, string[] endpoints)
    {
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
            [$"--DOTNET_LAUNCH_PROFILE={launchProfile}"], Ct);
        var api = builder.Resources.OfType<ProjectResource>().Single(resource => resource.Name == "api");
        api.Annotations.OfType<EndpointAnnotation>().Select(endpoint => endpoint.Name).ShouldBe(endpoints, ignoreOrder: true);
        var context = new ResourceUrlsCallbackContext(
            builder.ExecutionContext,
            api,
            [.. endpoints.Select(name => new ResourceUrlAnnotation { Url = $"{name}://api-scheduler.dev.localhost:7180", Endpoint = new EndpointReference(api, name) })],
            Ct);

        foreach (var annotation in api.Annotations.OfType<ResourceUrlsCallbackAnnotation>())
        {
            await annotation.Callback(context);
        }

        var scalar = context.Urls.Where(url => url.DisplayText == "Scalar API reference").ShouldHaveSingleItem();
        (scalar.Url, scalar.Endpoint?.EndpointName).ShouldBe(($"{endpoints[0]}://api-scheduler.dev.localhost:7180/scalar/v1", endpoints[0]));
        context.Urls.Where(url => url != scalar).Select(url => url.DisplayText).ShouldBe(endpoints.Select(name => $"API ({name})"));
    }

    [Fact]
    public async Task Mailpit_is_healthy_links_its_inbox_and_receives_a_booking_email_from_the_composed_api()
    {
        await appHost.App.ResourceNotifications.WaitForResourceHealthyAsync("mailpit", Ct).WaitAsync(TimeSpan.FromSeconds(30), Ct);
        using var mailpit = appHost.App.CreateHttpClient("mailpit", "http");
        using (var ready = await mailpit.GetAsync("/readyz", Ct))
        {
            ready.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        appHost.App.ResourceNotifications.TryGetCurrentState("mailpit", out var resource).ShouldBeTrue();
        resource!.Snapshot.Urls.ShouldContain(u => u.DisplayProperties.DisplayName == "Mailpit inbox");

        // Seeded @example.com addresses are suppressed, so only this non-reserved recipient receives mail.
        const string recipient = "aspire.smoke@inbox.keyloop.local";
        using var api = appHost.App.CreateHttpClient("api", "http");
        var booked = await BookAnyFreeSlotAsync(api, recipient);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            using var messages = JsonDocument.Parse(await mailpit.GetStringAsync("/api/v1/messages", timeout.Token));
            if (messages.RootElement.GetProperty("total").GetInt32() > 0)
            {
                var message = messages.RootElement.GetProperty("messages").EnumerateArray().ShouldHaveSingleItem("seeded @example.com bookings are never sent");
                message.GetProperty("To")[0].GetProperty("Address").GetString().ShouldBe(recipient);
                message.GetProperty("From").GetProperty("Address").GetString().ShouldBe("notifications@keyloop.example");
                message.GetProperty("Subject").GetString().ShouldBe($"Booking confirmation - {booked.ToString("N")[^8..].ToUpperInvariant()}");
                break;
            }
            await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
        }
    }

    /// <summary>Books the first free slot at the seeded Reading dealership in the coming days and returns the appointment id.</summary>
    private static async Task<Guid> BookAnyFreeSlotAsync(HttpClient api, string email)
    {
        using var dealerships = JsonDocument.Parse(await api.GetStringAsync("/api/v1/dealerships", Ct));
        var dealershipId = dealerships.RootElement.EnumerateArray()
            .Single(d => d.GetProperty("name").GetString() == "Keyloop Motors Reading").GetProperty("id").GetString();
        using var serviceTypes = JsonDocument.Parse(await api.GetStringAsync($"/api/v1/dealerships/{dealershipId}/service-types", Ct));
        foreach (var serviceType in serviceTypes.RootElement.EnumerateArray())
        {
            var serviceTypeId = serviceType.GetProperty("id").GetString();
            for (var day = 2; day <= 9; day++)
            {
                var date = DateTime.UtcNow.Date.AddDays(day).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
                using var availability = JsonDocument.Parse(
                    await api.GetStringAsync($"/api/v1/dealerships/{dealershipId}/availability?serviceTypeId={serviceTypeId}&date={date}", Ct));
                if (availability.RootElement.GetProperty("slots").EnumerateArray().FirstOrDefault() is not { ValueKind: JsonValueKind.Object } slot)
                {
                    continue;
                }
                var body = JsonSerializer.Serialize(new
                {
                    serviceTypeId,
                    startUtc = slot.GetProperty("startUtc").GetString(),
                    customer = new { name = "Aspire Smoke", email, phone = "+44 7700 900999" },
                    vehicle = new { vin = "WVWZZZ1KZAW654321", registration = "AS26 MKE", make = "Volkswagen", model = "Golf" },
                });
                using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
                using var response = await api.PostAsync($"/api/v1/dealerships/{dealershipId}/appointments", content, Ct);
                var answer = await response.Content.ReadAsStringAsync(Ct);
                response.StatusCode.ShouldBe(HttpStatusCode.Created, answer);
                using var appointment = JsonDocument.Parse(answer);
                return appointment.RootElement.GetProperty("id").GetGuid();
            }
        }
        throw new InvalidOperationException("No free slot at Reading in the coming days.");
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
            outcome.RootElement.GetProperty("appointmentsCreated").GetInt32().ShouldBeGreaterThan(0);
        }

        using var http = appHost.App.CreateHttpClient("api", "http");
        using var withoutKey = await http.PostAsync("/api/v1/admin/demo/reseed", content: null, Ct);
        withoutKey.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Development_database_is_persistent_with_generated_secret_credentials()
    {
        await using var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(Ct);

        var postgres = builder.Resources.OfType<PostgresServerResource>().ShouldHaveSingleItem();
        postgres.Annotations.OfType<ContainerImageAnnotation>().Last().Tag.ShouldBe("17");
        postgres.Annotations.OfType<ContainerLifetimeAnnotation>().Last().Lifetime.ShouldBe(ContainerLifetime.Persistent);
        var volume = postgres.Annotations.OfType<ContainerMountAnnotation>().ShouldHaveSingleItem();
        (volume.Type, volume.Source, volume.Target).ShouldBe((ContainerMountType.Volume, "keyloop-scheduler-pgdata", "/var/lib/postgresql/data"));

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
                [$"--Parameters:postgres-password={password}", "--Parameters:cloudflare-account-id=", "--Parameters:cloudflare-ai-token="], ct);
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
                await App.ResourceNotifications.WaitForResourceHealthyAsync("web", ct);
            }
            catch (Exception startupFailure)
            {
                try
                {
                    if (App is not null)
                    {
                        await DisposeAsync();
                    }
                    else
                    {
                        await builder.DisposeAsync();
                    }
                }
                catch (Exception cleanupFailure)
                {
                    throw new AggregateException("The AppHost did not start, and cleaning it up failed as well.", startupFailure, cleanupFailure);
                }

                throw;
            }
        }

        /// <summary>Returns the first applicationUrl of the AppHost's https launch profile.</summary>
        internal static string LaunchProfileDashboardUrl()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Keyloop.ServiceScheduler.sln")))
            {
                directory = directory.Parent;
            }

            var path = Path.Combine(directory!.FullName, "src", "Keyloop.ServiceScheduler.AppHost", "Properties", "launchSettings.json");
            using var settings = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip });
            return settings.RootElement.GetProperty("profiles").GetProperty("https").GetProperty("applicationUrl").GetString()!.Split(';')[0];
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

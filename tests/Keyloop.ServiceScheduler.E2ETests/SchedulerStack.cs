using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Testing;

namespace Keyloop.ServiceScheduler.E2ETests;

// Class fixtures share this collection: even different identities never boot overlapping AppHosts.
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SchedulerCollection
{
    public const string Name = "Whole stack, one AppHost at a time";
}

public sealed class AdminStack : SchedulerStack;
public sealed class VisitorStack : SchedulerStack
{
    protected override string Roles => "";
}

public abstract class SchedulerStack : IAsyncLifetime
{
    private static readonly Lazy<Task> BrowserInstall = new(() => Task.Run(() =>
    {
        // Idempotent on a browser-cache hit, and no PowerShell dependency on macOS or Linux.
        var arguments = Environment.GetEnvironmentVariable("KEYLOOP_E2E_INSTALL_DEPS") == "1"
            ? new[] { "install", "--with-deps", "chromium" }
            : new[] { "install", "chromium" };
        Microsoft.Playwright.Program.Main(arguments).ShouldBe(0, "Chromium installation");
    }));
    private DistributedApplication? app;
    private IDistributedApplicationTestingBuilder? builder;
    private IPlaywright? playwright;
    private FileStream? machineLease;
    protected virtual string Roles => "Admin";
    public HttpClient Api { get; private set; } = null!;
    public HttpClient Mailpit { get; private set; } = null!;
    public IBrowser Browser { get; private set; } = null!;
    public string WebUrl { get; private set; } = null!;
    public JsonObject Reading { get; private set; } = null!;
    public JsonArray Services { get; private set; } = null!;
    public string DealershipId => Reading.String("id");
    public string Date { get; private set; } = null!;
    public string Root { get; } = FindRoot();
    public string RunDirectory { get; private set; } = null!;
    public string DealershipPath => $"/api/v1/dealerships/{DealershipId}";
    public string PageUrl(string path, string? date = null) => $"{WebUrl}{path}?dealership={DealershipId}&date={date ?? Date}";

    public async ValueTask InitializeAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        var ct = deadline.Token;
        try
        {
            await AcquireMachineAsync(ct);
            await BrowserInstall.Value.WaitAsync(ct);
            RunDirectory = Path.Combine(Root, "TestResults", "e2e", $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{(Roles == "" ? "visitor" : "admin")}-{Guid.NewGuid():N}");
            Directory.CreateDirectory(RunDirectory);
            var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Keyloop_ServiceScheduler_AppHost>(
                [$"--Parameters:postgres-password={password}", "--AppHost:UsePersistentResources=false",
                 "--Parameters:cloudflare-account-id=", "--Parameters:cloudflare-ai-token=",
                 "--Parameters:auth-development-email=admin@keyloop.test", $"--Parameters:auth-development-roles={Roles}"], ct);
            foreach (var container in builder.Resources.OfType<ContainerResource>())
            {
                builder.CreateResourceBuilder(container).WithLifetime(ContainerLifetime.Session);
                container.Annotations.OfType<ContainerMountAnnotation>().Where(m => m.Type == ContainerMountType.Volume)
                    .ToList().ForEach(m => container.Annotations.Remove(m));
            }
            // Disable browser OTLP export when running without the Aspire dashboard collector.
            builder.CreateResourceBuilder(builder.Resources.OfType<IResourceWithEnvironment>().Single(r => r.Name == "web"))
                .WithEnvironment(context =>
                {
                    foreach (var key in context.EnvironmentVariables.Keys.Where(k => k.StartsWith("OTEL_", StringComparison.Ordinal)).ToList())
                    {
                        context.EnvironmentVariables.Remove(key);
                    }
                });
            // Raise the per-user global rate limit so all journeys in the class can share the Development identity.
            builder.CreateResourceBuilder(builder.Resources.OfType<IResourceWithEnvironment>().Single(r => r.Name == "api"))
                .WithEnvironment("Security__RateLimiting__GlobalPermitsPerMinute", "1200");
            app = await builder.BuildAsync(ct);
            await app.StartAsync(ct);
            foreach (var resource in new[] { "api", "web", "mailpit" })
            {
                await app.ResourceNotifications.WaitForResourceHealthyAsync(resource, ct);
            }
            Api = app.CreateHttpClient("api", "http");
            Mailpit = app.CreateHttpClient("mailpit", "http");
            WebUrl = app.GetEndpoint("web", "http").ToString().TrimEnd('/');
            var dealerships = (await GetAsync("/api/v1/dealerships")).AsArray();
            Reading = dealerships.OfType<JsonObject>().Single(d => d.String("name") == "Keyloop Motors Reading");
            Services = (await GetAsync($"{DealershipPath}/service-types")).AsArray();
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(Reading.String("timeZoneId"))));
            Date = Enumerable.Range(1, 7).Select(today.AddDays).First(day => Reading["operatingHours"]!.AsArray()
                .OfType<JsonObject>().Any(h => h.String("day") == day.DayOfWeek.ToString() && h["opensAt"] is not null))
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            playwright = await Microsoft.Playwright.Playwright.CreateAsync();
            Browser = await playwright.Chromium.LaunchAsync(new() { Headless = true });
        }
        catch
        {
            await DisposeAsync();
            throw;
        }
    }

    // Serialize AppHost instances across test runners via a lock file and process check.
    private async Task AcquireMachineAsync(CancellationToken ct)
    {
        while (machineLease is null)
        {
            try { machineLease = new FileStream("/tmp/keyloop-e2e-apphost.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { await Task.Delay(1000, ct); }
        }
        while (true)
        {
            using var ps = Process.Start(new ProcessStartInfo("ps", "-axo comm,args") { RedirectStandardOutput = true })!;
            var output = await ps.StandardOutput.ReadToEndAsync(ct);
            await ps.WaitForExitAsync(ct);
            var running = output.Split('\n').Where(line => line.Contains("AppHost", StringComparison.Ordinal)
                && (line.TrimStart().StartsWith("dotnet ", StringComparison.Ordinal) || line.TrimStart().StartsWith("aspire ", StringComparison.Ordinal)
                    || line.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.EndsWith("/dotnet", StringComparison.Ordinal) == true)).ToArray();
            if (running.Length == 0)
            {
                return;
            }

            TestContext.Current.SendDiagnosticMessage("Waiting for an existing AppHost to stop.");
            await Task.Delay(1000, ct);
        }
    }

    public async Task<JsonNode> GetAsync(string path)
    {
        using var response = await Api.GetAsync(path, TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }
    public async Task<JsonObject> BookAsync(string serviceName = "Interim Service", string? start = null, Customer? customer = null)
    {
        var service = Services.OfType<JsonObject>().Single(s => s.String("name") == serviceName);
        if (start is null)
        {
            var availability = await GetAsync($"{DealershipPath}/availability?serviceTypeId={service.String("id")}&date={Date}");
            start = availability["slots"]!.AsArray().First()!.String("startUtc");
        }
        customer ??= Customer.Unique();
        using var response = await Api.PostAsJsonAsync($"{DealershipPath}/appointments", new
        {
            serviceTypeId = service.String("id"), startUtc = start,
            customer = new { customer.Name, customer.Email, phone = "+44 7700 900999" },
            vehicle = new { customer.Vin, registration = customer.Registration, make = "E2E", model = "Scheduler" },
        }, TestContext.Current.CancellationToken);
        var body = await response.Content.ReadAsStringAsync();
        ((int)response.StatusCode).ShouldBe(201, body);
        return JsonNode.Parse(body)!.AsObject();
    }
    public Task<JsonNode> ScheduleAsync() => GetAsync($"{DealershipPath}/schedule?date={Date}");

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (Browser is not null)
            {
                await Browser.CloseAsync();
            }

            playwright?.Dispose();
            Api?.Dispose();
            Mailpit?.Dispose();
        }
        finally
        {
            try
            {
                if (app is not null)
                {
                    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                    try { await app.StopAsync(deadline.Token); }
                    finally { await app.DisposeAsync(); app = null; }
                }
            }
            finally
            {
                try { if (builder is not null) { await builder.DisposeAsync(); builder = null; } }
                finally { machineLease?.Dispose(); machineLease = null; }
            }
        }
    }

    private static string FindRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Keyloop.ServiceScheduler.sln")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Cannot find the repository root.");
    }
}

public sealed record Customer(string Name, string Email, string Vin, string Registration, string Notes)
{
    public static Customer Unique()
    {
        var key = Guid.NewGuid().ToString("N");
        var digits = string.Concat(key.Take(14).Select(c => (char)('0' + c % 10)));
        return new($"E2E {key[..10]}", $"e2e+{key}@e2e.keyloop.kylesmile.me", $"ZZZ{digits}", $"E2E {key[..6].ToUpperInvariant()}", $"Private workshop note {key}");
    }
}

internal static class JsonValues
{
    public static string String(this JsonNode node, string property) => node[property]!.GetValue<string>();
    public static IEnumerable<JsonObject> Appointments(this JsonNode schedule)
    {
        foreach (var bay in schedule["bays"]!.AsArray())
        {
            foreach (var appointment in bay!["appointments"]!.AsArray().OfType<JsonObject>())
            {
                var copy = (JsonObject)appointment.DeepClone();
                copy["bay"] = new JsonObject { ["id"] = bay["id"]!.DeepClone(), ["name"] = bay["name"]!.DeepClone() };
                yield return copy;
            }
        }
    }
}

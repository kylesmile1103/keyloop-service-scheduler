using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Deque.AxeCore.Playwright;

namespace Keyloop.ServiceScheduler.E2ETests;

/// <summary>One fresh browser context per test, with evidence retained if any assertion fails.</summary>
internal sealed class BrowserJourney(SchedulerStack stack, string directory) : IAsyncDisposable
{
    private readonly List<IBrowserContext> contexts = [];
    public List<string> BrowserErrors { get; } = [];
    public IPage Page { get; private set; } = null!;
    public string DirectoryPath => directory;
    public async Task<IPage> NewPageAsync(bool mobile = false)
    {
        var context = await stack.Browser.NewContextAsync(new()
        {
            ViewportSize = new() { Width = mobile ? 390 : 1440, Height = mobile ? 844 : 1000 },
            IsMobile = mobile, HasTouch = mobile, ColorScheme = ColorScheme.Light,
            RecordVideoDir = Path.Combine(directory, "video"),
        });
        context.SetDefaultTimeout(15_000);
        await context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
        contexts.Add(context);
        var page = await context.NewPageAsync();
        page.Console += (_, message) => { if (message.Type == "error") { BrowserErrors.Add($"console: {message.Text}"); } };
        page.PageError += (_, error) => BrowserErrors.Add($"page: {error}");
        page.RequestFailed += (_, request) => BrowserErrors.Add($"request: {request.Method} {request.Url}: {request.Failure}");
        page.Response += (_, response) => { if (response.Status >= 400) { BrowserErrors.Add($"HTTP {response.Status}: {response.Url}"); } };
        Page ??= page;
        return page;
    }
    public async Task GotoBoardAsync(IPage? page = null)
    {
        page ??= Page;
        var loaded = page.WaitForResponseAsync(r => r.Url.Contains("/schedule?", StringComparison.Ordinal) && r.Status == 200);
        await page.GotoAsync(stack.PageUrl("/dispatch"));
        await loaded;
        await Expect(page.GetByRole(AriaRole.Heading, new() { Name = "Dispatch board", Exact = true })).ToBeVisibleAsync();
        await Expect(page.GetByRole(AriaRole.Combobox, new() { Name = "Dealership", Exact = true })).ToContainTextAsync("Keyloop Motors Reading");
    }
    public async Task<ILocator> PrepareBookingAsync(Customer customer, string service = "Interim Service", bool electric = false, string? startLocal = null)
    {
        await Page.GetByRole(AriaRole.Button, new() { Name = "Book appointment", Exact = true }).ClickAsync();
        var dialog = Page.GetByRole(AriaRole.Dialog, new() { Name = "Book appointment", Exact = true });
        await dialog.GetByRole(AriaRole.Combobox, new() { Name = "Service", Exact = true }).ClickAsync();
        await Page.GetByRole(AriaRole.Option, new() { NameRegex = new Regex($"^{Regex.Escape(service)}(?: |$)") }).ClickAsync();
        if (electric)
        {
            await dialog.GetByRole(AriaRole.Combobox, new() { Name = "Powertrain", Exact = true }).ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { NameRegex = new Regex("^Battery electric") }).ClickAsync();
            await dialog.GetByLabel("Why you’re declaring it", new() { Exact = true }).FillAsync(customer.Notes);
        }
        var slots = dialog.GetByRole(AriaRole.Radio, new() { NameRegex = new Regex(startLocal is null ? @"^\d\d:\d\d, .* free$" : $"^{Regex.Escape(startLocal)}, .* free$") });
        await slots.First.ClickAsync();
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Next", Exact = true }).ClickAsync();
        foreach (var (label, value) in new[] { ("Name", customer.Name), ("Email", customer.Email), ("Phone", "+44 7700 900999"), ("VIN", customer.Vin), ("Registration", customer.Registration), ("Make", "E2E"), ("Model", "Scheduler"), ("Notes for the workshop", customer.Notes) })
        {
            await dialog.GetByRole(AriaRole.Textbox, new() { Name = label, Exact = true }).FillAsync(value);
        }
        return dialog;
    }
    public async Task<JsonObject> SubmitBookingAsync(ILocator dialog)
    {
        var answer = Page.WaitForResponseAsync(IsBookingResponse);
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Book", Exact = true }).ClickAsync();
        var response = await answer;
        response.Status.ShouldBe(201, await response.TextAsync());
        return JsonNode.Parse(await response.TextAsync())!.AsObject();
    }
    public static bool IsBookingResponse(IResponse response) => response.Request.Method == "POST" && response.Url.EndsWith("/appointments", StringComparison.Ordinal);
    public static ILocator Block(IPage page, JsonObject appointment) => page.GetByRole(AriaRole.Button, new() { NameRegex = BlockName(appointment) });
    public static ILocator Block(ILocator region, JsonObject appointment) => region.GetByRole(AriaRole.Button, new() { NameRegex = BlockName(appointment) });
    private static Regex BlockName(JsonObject appointment) => new($"^(?:[^,]+, )?{Regex.Escape(appointment["serviceType"]!.String("name"))}, {Regex.Escape(appointment["bay"]!.String("name"))}, {appointment.String("startLocal")[11..16]} to {appointment.String("endLocal")[11..16]},");
    public async Task ScanAsync(string name)
    {
        // No disabled rules or excluded regions. Full axe results preserve lower-impact and incomplete findings too.
        // Inspect settled colors/layout, not a sheet's intermediate opacity during its entrance animation.
        await Page.EvaluateAsync("async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }");
        var result = await Page.RunAxe();
        await File.WriteAllTextAsync(Path.Combine(directory, $"axe-{name}.json"), result.ToString());
        var severe = result.Violations.Where(v => v.Impact is "serious" or "critical").ToArray();
        severe.ShouldBeEmpty(string.Join('\n', severe.Select(v => $"{v.Id}: {v.Description}: {string.Join(", ", v.Nodes.Select(n => n.Html))}")));
    }
    public async Task FinishAsync(bool success)
    {
        for (var i = 0; i < contexts.Count; i++)
        {
            var context = contexts[i];
            if (!success)
            {
                foreach (var page in context.Pages.Where(p => !p.IsClosed))
                {
                    await page.ScreenshotAsync(new() { Path = Path.Combine(directory, $"failure-{i}.png"), FullPage = true });
                    await File.WriteAllTextAsync(Path.Combine(directory, $"failure-{i}.aria.txt"), await page.Locator("body").AriaSnapshotAsync());
                }
            }
            await context.Tracing.StopAsync(success ? new() : new() { Path = Path.Combine(directory, $"trace-{i}.zip") });
            await context.CloseAsync();
        }
        contexts.Clear();
        await File.WriteAllLinesAsync(Path.Combine(directory, "browser.log"), BrowserErrors);
        if (success && Directory.Exists(Path.Combine(directory, "video")))
        {
            Directory.Delete(Path.Combine(directory, "video"), recursive: true);
        }
    }
    public async ValueTask DisposeAsync()
    {
        foreach (var context in contexts)
        {
            await context.CloseAsync();
        }
    }
    public static async Task RunAsync(SchedulerStack stack, string name, Func<BrowserJourney, Task> test, bool mobile = false)
    {
        var directory = Path.Combine(stack.RunDirectory, name);
        Directory.CreateDirectory(directory);
        await using var journey = new BrowserJourney(stack, directory);
        var clock = Stopwatch.StartNew();
        var success = false;
        try
        {
            await journey.NewPageAsync(mobile);
            await test(journey);
            success = true;
        }
        catch (Exception error)
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "failure.txt"), error.ToString());
            throw;
        }
        finally
        {
            await journey.FinishAsync(success);
            await File.WriteAllTextAsync(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { name, success, seconds = clock.Elapsed.TotalSeconds }));
        }
    }
}

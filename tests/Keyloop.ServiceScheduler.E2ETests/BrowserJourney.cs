using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Deque.AxeCore.Playwright;

namespace Keyloop.ServiceScheduler.E2ETests;

/// <summary>One fresh browser context per test, with evidence retained if any assertion fails.</summary>
internal sealed class BrowserJourney(SchedulerStack stack, string directory)
{
    /// <summary>Navigation and initial board readiness timeout to accommodate cold Vite module transforms.</summary>
    public const float PageLoadTimeout = 60_000;

    /// <summary>Maximum duration for each failure-artifact capture step.</summary>
    private static readonly TimeSpan CaptureStepTimeout = TimeSpan.FromSeconds(20);

    private readonly List<IBrowserContext> contexts = [];
    private readonly List<double> boardReadySeconds = [];
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
        context.SetDefaultNavigationTimeout(PageLoadTimeout);
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
    /// <summary>Opens the dispatch board and waits for the schedule response and board heading.</summary>
    public async Task GotoBoardAsync(IPage? page = null)
    {
        page ??= Page;
        var clock = Stopwatch.StartNew();
        var loaded = page.WaitForResponseAsync(r => r.Url.Contains("/schedule?", StringComparison.Ordinal) && r.Status == 200, new() { Timeout = PageLoadTimeout });
        await page.GotoAsync(stack.PageUrl("/dispatch"), new() { WaitUntil = WaitUntilState.Commit });
        await loaded;
        await Expect(page.GetByRole(AriaRole.Heading, new() { Name = "Dispatch board", Exact = true })).ToBeVisibleAsync(new() { Timeout = PageLoadTimeout });
        await Expect(page.GetByRole(AriaRole.Combobox, new() { Name = "Dealership", Exact = true })).ToContainTextAsync("Keyloop Motors Reading");
        boardReadySeconds.Add(Math.Round(clock.Elapsed.TotalSeconds, 2));
    }
    public async Task<ILocator> PrepareBookingAsync(Customer customer, string service = "Interim Service", bool electric = false, string? startLocal = null)
    {
        var dialog = await OpenStepTwoAsync(service, electric ? customer.Notes : null, startLocal);
        foreach (var (label, value) in new[] { ("Name", customer.Name), ("Email", customer.Email), ("Phone", "+44 7700 900999"), ("VIN", customer.Vin), ("Registration", customer.Registration), ("Make", "E2E"), ("Model", "Scheduler"), ("Notes for the workshop", customer.Notes) })
        {
            await dialog.GetByRole(AriaRole.Textbox, new() { Name = label, Exact = true }).FillAsync(value);
        }
        return dialog;
    }
    /// <summary>Opens the booking dialog and completes step 1, leaving step 2 ready for customer and vehicle input.</summary>
    public async Task<ILocator> OpenStepTwoAsync(string service = "Interim Service", string? electricReason = null, string? startLocal = null)
    {
        await Page.GetByRole(AriaRole.Button, new() { Name = "Book appointment", Exact = true }).ClickAsync();
        var dialog = Page.GetByRole(AriaRole.Dialog, new() { Name = "Book appointment", Exact = true });
        await dialog.GetByRole(AriaRole.Combobox, new() { Name = "Service", Exact = true }).ClickAsync();
        await Page.GetByRole(AriaRole.Option, new() { NameRegex = new Regex($"^{Regex.Escape(service)}(?: |$)") }).ClickAsync();
        if (electricReason is not null)
        {
            await dialog.GetByRole(AriaRole.Combobox, new() { Name = "Powertrain", Exact = true }).ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { NameRegex = new Regex("^Battery electric") }).ClickAsync();
            await dialog.GetByLabel("Why you’re declaring it", new() { Exact = true }).FillAsync(electricReason);
        }
        var slots = dialog.GetByRole(AriaRole.Radio, new() { NameRegex = new Regex(startLocal is null ? @"^\d\d:\d\d, .* free$" : $"^{Regex.Escape(startLocal)}, .* free$") });
        await slots.First.ClickAsync();
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Next", Exact = true }).ClickAsync();
        await Expect(dialog.GetByRole(AriaRole.Heading, new() { Name = "Customer and vehicle", Exact = true })).ToBeVisibleAsync();
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
        // Wait for finite animations to settle before running axe.
        await Page.EvaluateAsync("async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }");
        var result = await Page.RunAxe();
        await File.WriteAllTextAsync(Path.Combine(directory, $"axe-{name}.json"), result.ToString());
        var severe = result.Violations.Where(v => v.Impact is "serious" or "critical").ToArray();
        severe.ShouldBeEmpty(string.Join('\n', severe.Select(v => $"{v.Id}: {v.Description}: {string.Join(", ", v.Nodes.Select(n => n.Html))}")));
    }
    public static async Task RunAsync(SchedulerStack stack, string name, Func<BrowserJourney, Task> test, bool mobile = false)
    {
        var directory = Path.Combine(stack.RunDirectory, name);
        Directory.CreateDirectory(directory);
        var journey = new BrowserJourney(stack, directory);
        var clock = Stopwatch.StartNew();
        try
        {
            await journey.NewPageAsync(mobile);
            await test(journey);
        }
        catch (Exception error)
        {
            try
            {
                await journey.CaptureFailureAsync(name, error, clock.Elapsed);
            }
            catch (Exception captureFailure)
            {
                TestContext.Current.TestOutputHelper?.WriteLine($"Failure evidence could not be gathered: {captureFailure}");
            }

            throw;
        }

        await journey.FinishAsync(name, clock.Elapsed);
    }

    /// <summary>Discards traces and videos on success and writes the test result.</summary>
    private async Task FinishAsync(string name, TimeSpan elapsed)
    {
        foreach (var context in contexts)
        {
            await context.Tracing.StopAsync();
            await context.CloseAsync();
        }

        contexts.Clear();
        await File.WriteAllLinesAsync(Path.Combine(directory, "browser.log"), BrowserErrors);
        if (Directory.Exists(Path.Combine(directory, "video")))
        {
            Directory.Delete(Path.Combine(directory, "video"), recursive: true);
        }

        await WriteResultAsync(name, success: true, elapsed);
    }

    /// <summary>Captures failure artifacts (exception, trace, screenshots, ARIA snapshot, and logs) with bounded per-step timeouts.</summary>
    private async Task CaptureFailureAsync(string name, Exception error, TimeSpan elapsed)
    {
        var problems = new List<string>();
        async Task Attempt(string step, Func<Task> capture)
        {
            try
            {
                await capture().WaitAsync(CaptureStepTimeout);
            }
            catch (Exception failure)
            {
                problems.Add($"{step}: {failure.GetType().Name}: {failure.Message.Split('\n')[0]}");
            }
        }

        var stepTimeout = (float)CaptureStepTimeout.TotalMilliseconds;
        await Attempt("failure.txt", () => File.WriteAllTextAsync(Path.Combine(directory, "failure.txt"), error.ToString()));
        for (var i = 0; i < contexts.Count; i++)
        {
            var context = contexts[i];
            var index = i;
            await Attempt($"trace-{index}.zip", () => context.Tracing.StopAsync(new() { Path = Path.Combine(directory, $"trace-{index}.zip") }));
            foreach (var page in context.Pages.Where(p => !p.IsClosed))
            {
                await Attempt($"failure-{index}.png", () => page.ScreenshotAsync(new() { Path = Path.Combine(directory, $"failure-{index}.png"), FullPage = true, Timeout = stepTimeout }));
                await Attempt($"failure-{index}.aria.txt", async () =>
                    await File.WriteAllTextAsync(Path.Combine(directory, $"failure-{index}.aria.txt"), await page.Locator("body").AriaSnapshotAsync(new() { Timeout = stepTimeout })));
            }

            await Attempt($"closing context {index}", () => context.CloseAsync());
        }

        contexts.Clear();
        await Attempt("browser.log", () => File.WriteAllLinesAsync(Path.Combine(directory, "browser.log"), BrowserErrors));
        if (problems.Count > 0)
        {
            await Attempt("capture.log", () => File.WriteAllLinesAsync(Path.Combine(directory, "capture.log"), problems));
            TestContext.Current.TestOutputHelper?.WriteLine($"Failure evidence incomplete ({directory}):{Environment.NewLine}{string.Join(Environment.NewLine, problems)}");
        }

        await Attempt("result.json", () => WriteResultAsync(name, success: false, elapsed));
    }

    private Task WriteResultAsync(string name, bool success, TimeSpan elapsed) =>
        File.WriteAllTextAsync(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { name, success, seconds = elapsed.TotalSeconds, boardReadySeconds }));
}

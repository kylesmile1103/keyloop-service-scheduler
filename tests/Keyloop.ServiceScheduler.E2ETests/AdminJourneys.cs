using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Keyloop.ServiceScheduler.E2ETests;

public sealed partial class SchedulerJourneys
{
    [Fact]
    public Task Admin_edits_compare_stale_versions_and_publish_only_a_current_policy_preview() => Run(nameof(Admin_edits_compare_stale_versions_and_publish_only_a_current_policy_preview), async journey =>
    {
        var page = journey.Page;
        var second = await journey.NewPageAsync();
        const string original = "Amelia Clarke";
        var firstName = $"Amelia E2E {Guid.NewGuid():N}";
        var staleName = $"Amelia comparison {Guid.NewGuid():N}";
        var schedule = await stack.ScheduleAsync();
        var technicianId = schedule["technicians"]!.AsArray().Single(t => t!.String("name") == original)!.String("id");
        var resourcePath = $"{stack.DealershipPath}/technicians/{technicianId}";
        var originalRecord = (await stack.GetAsync(resourcePath)).AsObject();
        JsonObject? originalPolicy = null;
        try
        {
            var form = await OpenTechnicianAsync(page, original);
            var staleForm = await OpenTechnicianAsync(second, original);
            await form.GetByRole(AriaRole.Textbox, new() { Name = "Name", Exact = true }).FillAsync(firstName);
            await staleForm.GetByRole(AriaRole.Textbox, new() { Name = "Name", Exact = true }).FillAsync(staleName);
            await SaveTechnicianAsync(page, form, 200);
            await journey.GotoBoardAsync();
            await page.GetByRole(AriaRole.Tab, new() { Name = "Technicians", Exact = true }).ClickAsync();
            await Expect(page.GetByText(firstName, new() { Exact = true }).First).ToBeVisibleAsync();
            await SaveTechnicianAsync(second, staleForm, 412);
            var comparison = staleForm.GetByRole(AriaRole.Region, new() { Name = $"Someone else changed {original}", Exact = true });
            await Expect(comparison).ToContainTextAsync(firstName);
            await Expect(comparison).ToContainTextAsync(staleName);
            var writes = 0;
            second.Request += (_, request) => { if (request.Method == "PUT" && request.Url.EndsWith($"/technicians/{technicianId}", StringComparison.Ordinal)) { writes++; } };
            await comparison.GetByRole(AriaRole.Button, new() { Name = "Reapply my changes", Exact = true }).ClickAsync();
            await Expect(staleForm.GetByText("Your changes are applied to the latest version. Check them, then save.", new() { Exact = true })).ToBeVisibleAsync();
            (await stack.GetAsync(resourcePath)).String("name").ShouldBe(firstName);
            writes.ShouldBe(0, "Reapply must not save");
            await SaveTechnicianAsync(second, staleForm, 200);
            writes.ShouldBe(1);

            await page.GotoAsync(stack.PageUrl("/resources/policy"));
            var before = await stack.GetAsync($"{stack.DealershipPath}/requirement-policy");
            originalPolicy = before.AsObject();
            var version = before["version"]!.GetValue<int>();
            const string code = "hv-routine";
            await page.GetByRole(AriaRole.Button, new() { Name = $"Edit {code}", Exact = true }).ClickAsync();
            var rule = page.GetByRole(AriaRole.Dialog, new() { Name = $"Edit rule {code}", Exact = true });
            await rule.GetByRole(AriaRole.Radio, new() { NameRegex = new Regex("^Level 4,") }).ClickAsync();
            await rule.GetByRole(AriaRole.Button, new() { Name = "Save rule", Exact = true }).ClickAsync();
            var publish = page.GetByRole(AriaRole.Button, new() { Name = $"Publish version {version + 1}", Exact = true });
            await Expect(publish).ToHaveAttributeAsync("aria-disabled", "true");
            var previewResponse = page.WaitForResponseAsync(IsPolicyWrite);
            await page.GetByRole(AriaRole.Button, new() { Name = "Preview changes", Exact = true }).ClickAsync();
            var preview = await previewResponse;
            preview.Status.ShouldBe(200);
            var previewBody = JsonNode.Parse(await preview.TextAsync())!;
            previewBody["saved"]!.GetValue<bool>().ShouldBeFalse();
            previewBody.String("previewToken").ShouldNotBeNullOrWhiteSpace();
            await Expect(page.GetByRole(AriaRole.Heading, new() { Name = $"What version {version + 1} would change", Exact = true })).ToBeVisibleAsync();
            await Expect(publish).ToBeEnabledAsync();

            // A concurrent roster edit invalidates the preview token.
            var renamed = $"Amelia roster {Guid.NewGuid():N}";
            var rosterEdit = await ChangeNameAsync(second, staleName, renamed);
            await rosterEdit.GetByRole(AriaRole.Radio, new() { NameRegex = new Regex("^Level 4,") }).ClickAsync();
            await SaveTechnicianAsync(second, rosterEdit, 200);
            var outdatedResponse = page.WaitForResponseAsync(IsPolicyWrite);
            await publish.ClickAsync();
            var outdated = await outdatedResponse;
            outdated.Status.ShouldBe(409);
            JsonNode.Parse(await outdated.TextAsync())!.String("type").ShouldEndWith("/policy-preview-outdated");
            await Expect(page.GetByRole(AriaRole.Alert)).ToContainTextAsync("The preview is out of date");
            (await stack.GetAsync($"{stack.DealershipPath}/requirement-policy"))["version"]!.GetValue<int>().ShouldBe(version);
            var refreshed = page.WaitForResponseAsync(IsPolicyWrite);
            await page.GetByRole(AriaRole.Button, new() { Name = "Preview again", Exact = true }).ClickAsync();
            (await refreshed).Status.ShouldBe(200);
            var published = page.WaitForResponseAsync(IsPolicyWrite);
            await publish.ClickAsync();
            var publication = await published;
            publication.Status.ShouldBe(200);
            JsonNode.Parse(await publication.TextAsync())!["saved"]!.GetValue<bool>().ShouldBeTrue();
            await Expect(page.GetByRole(AriaRole.Heading, new() { Name = $"Version {version + 1}", Exact = true, Level = 2 })).ToBeVisibleAsync();
            await page.GotoAsync(stack.PageUrl("/resources/history"));
            var feed = page.GetByRole(AriaRole.Feed, new() { Name = "Changes", Exact = true });
            await Expect(feed.GetByRole(AriaRole.Article, new() { NameRegex = new Regex($"^{Regex.Escape(renamed)} edited$") })).ToBeVisibleAsync();
            await Expect(feed.GetByRole(AriaRole.Article, new() { Name = $"Requirement policy version {version + 1} published", Exact = true })).ToBeVisibleAsync();
        }
        finally
        {
            using var get = await stack.Api.GetAsync(resourcePath);
            get.EnsureSuccessStatusCode();
            var current = (JsonObject)originalRecord.DeepClone();
            current.Remove("id"); current.Remove("dealershipId"); current.Remove("version");
            using var request = new HttpRequestMessage(HttpMethod.Put, resourcePath) { Content = new StringContent(current.ToJsonString(), System.Text.Encoding.UTF8, "application/json") };
            request.Headers.TryAddWithoutValidation("If-Match", get.Headers.ETag!.ToString());
            using var response = await stack.Api.SendAsync(request);
            response.EnsureSuccessStatusCode();
            if (originalPolicy is not null)
            {
                using var policyGet = await stack.Api.GetAsync($"{stack.DealershipPath}/requirement-policy");
                policyGet.EnsureSuccessStatusCode();
                var policyNow = JsonNode.Parse(await policyGet.Content.ReadAsStringAsync())!;
                if (policyNow["version"]!.GetValue<int>() != originalPolicy["version"]!.GetValue<int>())
                {
                    var previewDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(stack.Reading.String("timeZoneId")))).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
                    var preview = await RestorePolicyAsync(originalPolicy["rules"]!, policyGet.Headers.ETag!.ToString(), previewDate, null);
                    await RestorePolicyAsync(originalPolicy["rules"]!, policyGet.Headers.ETag!.ToString(), previewDate, preview.String("previewToken"));
                }
            }
        }
    });

    [Fact]
    public Task Board_appointments_booking_and_Admin_forms_have_no_serious_accessibility_violations() => Run(nameof(Board_appointments_booking_and_Admin_forms_have_no_serious_accessibility_violations), async journey =>
    {
        await journey.GotoBoardAsync();
        await journey.ScanAsync("board");
        await journey.Page.GotoAsync(stack.PageUrl("/appointments"));
        await Expect(journey.Page.GetByRole(AriaRole.Searchbox, new() { Name = "Search appointments", Exact = true })).ToBeVisibleAsync();
        await journey.ScanAsync("appointments");
        await journey.GotoBoardAsync();
        var dialog = await journey.PrepareBookingAsync(Customer.Unique());
        await journey.ScanAsync("booking-customer");
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Back", Exact = true }).ClickAsync();
        await Expect(dialog.GetByRole(AriaRole.Combobox, new() { Name = "Service", Exact = true })).ToBeVisibleAsync();
        await journey.ScanAsync("booking-service");
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Close", Exact = true }).ClickAsync();
        var edit = await OpenTechnicianAsync(journey.Page, "Amelia Clarke");
        await Expect(edit.GetByRole(AriaRole.Textbox, new() { Name = "Employee number", Exact = true })).ToBeVisibleAsync();
        await journey.ScanAsync("admin-technician");
        await edit.GetByRole(AriaRole.Button, new() { Name = "Cancel", Exact = true }).ClickAsync();
        await journey.Page.GotoAsync(stack.PageUrl("/resources/policy"));
        await Expect(journey.Page.GetByRole(AriaRole.Button, new() { Name = "Add rule", Exact = true })).ToBeVisibleAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Table, new() { Name = "Rules", Exact = true })).ToBeVisibleAsync();
        await journey.ScanAsync("policy");
    });

    private async Task<ILocator> OpenTechnicianAsync(IPage page, string name)
    {
        await page.GotoAsync(stack.PageUrl("/resources/technicians"));
        await page.GetByRole(AriaRole.Button, new() { Name = $"Actions for {name}", Exact = true }).ClickAsync();
        await page.GetByRole(AriaRole.Menuitem, new() { Name = "Edit", Exact = true }).ClickAsync();
        var form = page.GetByRole(AriaRole.Dialog, new() { Name = $"Edit {name}", Exact = true });
        await Expect(form.GetByRole(AriaRole.Textbox, new() { Name = "Name", Exact = true })).ToHaveValueAsync(name);
        return form;
    }
    private async Task<ILocator> ChangeNameAsync(IPage page, string previous, string next)
    {
        var form = await OpenTechnicianAsync(page, previous);
        await form.GetByRole(AriaRole.Textbox, new() { Name = "Name", Exact = true }).FillAsync(next);
        return form;
    }
    private static async Task SaveTechnicianAsync(IPage page, ILocator form, int status)
    {
        var answer = page.WaitForResponseAsync(r => r.Request.Method == "PUT" && r.Url.Contains("/technicians/", StringComparison.Ordinal));
        await form.GetByRole(AriaRole.Button, new() { Name = "Save changes", Exact = true }).ClickAsync();
        var response = await answer;
        response.Status.ShouldBe(status, await response.TextAsync());
        if (status == 200)
        {
            await Expect(form).ToHaveCountAsync(0);
        }
    }
    private async Task<JsonNode> RestorePolicyAsync(JsonNode rules, string tag, string date, string? token)
    {
        var body = new JsonObject { ["rules"] = rules.DeepClone(), ["dryRun"] = token is null, ["previewDate"] = date, ["previewToken"] = token };
        using var request = new HttpRequestMessage(HttpMethod.Put, $"{stack.DealershipPath}/requirement-policy") { Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("If-Match", tag);
        using var response = await stack.Api.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }
    private static bool IsPolicyWrite(IResponse response) => response.Request.Method == "PUT" && response.Url.EndsWith("/requirement-policy", StringComparison.Ordinal);
}

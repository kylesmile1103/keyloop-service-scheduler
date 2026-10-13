using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Keyloop.ServiceScheduler.E2ETests;

[Collection(SchedulerCollection.Name)]
[Trait("Category", "E2E")]
public sealed partial class SchedulerJourneys(AdminStack stack) : IClassFixture<AdminStack>
{
    [Fact]
    public Task Board_shows_Readings_resources_and_seeded_work_without_browser_errors() => Run(nameof(Board_shows_Readings_resources_and_seeded_work_without_browser_errors), async journey =>
    {
        var schedule = await stack.ScheduleAsync();
        var appointments = schedule.Appointments().ToArray();
        appointments.ShouldNotBeEmpty("the next open day must be in the seed's rolling week");
        await journey.GotoBoardAsync();
        foreach (var bay in schedule["bays"]!.AsArray())
        {
            await Expect(journey.Page.GetByText(bay!.String("name"), new() { Exact = true }).First).ToBeVisibleAsync();
        }

        foreach (var appointment in appointments)
        {
            await Expect(BrowserJourney.Block(journey.Page, appointment)).ToBeVisibleAsync();
        }

        await journey.Page.GetByRole(AriaRole.Tab, new() { Name = "Technicians", Exact = true }).ClickAsync();
        foreach (var technician in schedule["technicians"]!.AsArray())
        {
            await Expect(journey.Page.GetByText(technician!.String("name"), new() { Exact = true }).First).ToBeVisibleAsync();
        }

        journey.BrowserErrors.ShouldBeEmpty("no expected failures on a healthy board load");
    });

    [Fact]
    public Task Booking_allocates_resources_pulses_on_the_board_and_is_persisted() => Run(nameof(Booking_allocates_resources_pulses_on_the_board_and_is_persisted), async journey =>
    {
        var customer = Customer.Unique();
        await journey.GotoBoardAsync();
        var appointment = await journey.SubmitBookingAsync(await journey.PrepareBookingAsync(customer));
        await AssertBookedAsync(journey, appointment, customer);
        var block = BrowserJourney.Block(journey.Page, appointment);
        await Expect(block).ToHaveAttributeAsync("data-booked", "true");
        await Expect(block).ToHaveCSSAsync("animation-name", "booked-halo");
    });

    [Fact]
    public Task Taken_slot_explains_the_conflict_and_a_suggested_slot_recovers() => Run(nameof(Taken_slot_explains_the_conflict_and_a_suggested_slot_recovers), async journey =>
    {
        var customer = Customer.Unique();
        await journey.GotoBoardAsync();
        var dialog = await journey.PrepareBookingAsync(customer, "EV Battery Health Check");
        // The EV service has just one bay/technician pair. Take it after the dialog read availability and before its POST.
        string? takenStart = null;
        string? bookingKey = null;
        await journey.Page.RouteAsync("**/appointments", async route =>
        {
            if (route.Request.Method != "POST") { await route.ContinueAsync(); return; }
            var payload = JsonNode.Parse(route.Request.PostData!)!;
            takenStart = payload.String("startUtc");
            bookingKey = route.Request.Headers["idempotency-key"];
            await stack.BookAsync("EV Battery Health Check", takenStart);
            await route.ContinueAsync();
        });
        var answer = journey.Page.WaitForResponseAsync(BrowserJourney.IsBookingResponse);
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Book", Exact = true }).ClickAsync();
        var conflict = await answer;
        conflict.Status.ShouldBe(409, await conflict.TextAsync());
        var problem = JsonNode.Parse(await conflict.TextAsync())!;
        problem.String("type").ShouldEndWith("/slot-unavailable");
        await Expect(dialog.GetByRole(AriaRole.Alert)).ToContainTextAsync("Slot just taken - pick another time");
        await journey.Page.UnrouteAsync("**/appointments");
        var booked = journey.Page.WaitForResponseAsync(BrowserJourney.IsBookingResponse);
        await dialog.GetByRole(AriaRole.Button, new() { NameRegex = new Regex("^Book at .* instead$") }).First.ClickAsync();
        var recovery = await booked;
        recovery.Status.ShouldBe(201, await recovery.TextAsync());
        var appointment = JsonNode.Parse(await recovery.TextAsync())!.AsObject();
        appointment.String("startUtc").ShouldNotBe(takenStart);
        recovery.Request.Headers["idempotency-key"].ShouldBe(bookingKey);
        await AssertBookedAsync(journey, appointment, customer);
    });

    [Fact]
    public Task Business_rule_and_malformed_requests_render_readable_form_errors() => Run(nameof(Business_rule_and_malformed_requests_render_readable_form_errors), async journey =>
    {
        await journey.GotoBoardAsync();
        var dialog = await journey.PrepareBookingAsync(Customer.Unique());
        // Mutate only the outgoing body, then let the real API validate it; no canned ProblemDetails answers.
        await journey.Page.RouteAsync("**/appointments", async route =>
        {
            if (route.Request.Method != "POST") { await route.ContinueAsync(); return; }
            var body = JsonNode.Parse(route.Request.PostData!)!;
            var local = DateTime.ParseExact(stack.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddHours(22);
            body["startUtc"] = TimeZoneInfo.ConvertTimeToUtc(local, TimeZoneInfo.FindSystemTimeZoneById(stack.Reading.String("timeZoneId"))).ToString("O");
            await route.ContinueAsync(new() { PostData = Encoding.UTF8.GetBytes(body.ToJsonString()) });
        });
        var business = journey.Page.WaitForResponseAsync(BrowserJourney.IsBookingResponse);
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Book", Exact = true }).ClickAsync();
        (await business).Status.ShouldBe(422);
        await Expect(dialog.GetByRole(AriaRole.Alert)).ToContainTextAsync("operating hours");
        await Expect(dialog.GetByRole(AriaRole.Button, new() { Name = "Pick another time" })).ToBeVisibleAsync();
        await journey.Page.UnrouteAsync("**/appointments");
        await journey.Page.RouteAsync("**/appointments", async route =>
        {
            if (route.Request.Method != "POST") { await route.ContinueAsync(); return; }
            var body = JsonNode.Parse(route.Request.PostData!)!;
            body["vehicle"]!["vin"] = "INVALID";
            await route.ContinueAsync(new() { PostData = Encoding.UTF8.GetBytes(body.ToJsonString()) });
        });
        var malformed = journey.Page.WaitForResponseAsync(BrowserJourney.IsBookingResponse);
        await dialog.GetByRole(AriaRole.Button, new() { Name = "Book", Exact = true }).ClickAsync();
        (await malformed).Status.ShouldBe(400);
        await Expect(dialog.GetByRole(AriaRole.Textbox, new() { Name = "VIN", Exact = true })).ToHaveAttributeAsync("aria-invalid", "true");
        await Expect(dialog.GetByText(new Regex("VIN.*17"))).ToBeVisibleAsync();
        (await dialog.InnerTextAsync()).ShouldNotContain("{\"type\"");
        await Expect(journey.Page.GetByText("Booked", new() { Exact = true })).ToHaveCountAsync(0);
    });

    [Fact]
    public Task Cancelling_from_the_docked_details_removes_the_block_and_records_the_reason() => Run(nameof(Cancelling_from_the_docked_details_removes_the_block_and_records_the_reason), async journey =>
    {
        var customer = Customer.Unique();
        var appointment = await stack.BookAsync(customer: customer);
        await journey.GotoBoardAsync();
        var block = BrowserJourney.Block(journey.Page, appointment);
        await block.ClickAsync();
        // At 1440 px the details dock beside the board: no dialog, the board stays usable and marks the booking shown.
        var details = journey.Page.GetByRole(AriaRole.Complementary, new() { Name = "Appointment details", Exact = true });
        await Expect(details.GetByRole(AriaRole.Heading, new() { Name = "Interim Service", Exact = true })).ToBeFocusedAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Dialog)).ToHaveCountAsync(0);
        await Expect(block).ToHaveAttributeAsync("aria-current", "true");
        await Expect(details.GetByText(customer.Email, new() { Exact = true })).ToBeVisibleAsync();
        // The inspector ends inside the window: its action is in view without scrolling the page, and so is the confirm.
        await Expect(details).ToHaveCSSAsync("position", "sticky");
        var start = details.GetByRole(AriaRole.Button, new() { Name = "Cancel booking…", Exact = true });
        await Expect(start).ToBeInViewportAsync(new() { Ratio = 1 });
        await start.ClickAsync();
        var reason = details.GetByRole(AriaRole.Textbox, new() { Name = "Reason", Exact = true });
        await Expect(reason).ToBeFocusedAsync();
        await Expect(reason).ToBeInViewportAsync(new() { Ratio = 1 });
        await Expect(details.GetByRole(AriaRole.Button, new() { Name = "Cancel appointment", Exact = true })).ToBeInViewportAsync(new() { Ratio = 1 });
        await journey.ScanAsync("board-details-confirm");
        await reason.FillAsync(customer.Notes);
        var cancelled = journey.Page.WaitForResponseAsync(r => r.Request.Method == "POST" && r.Url.EndsWith("/cancel", StringComparison.Ordinal));
        await details.GetByRole(AriaRole.Button, new() { Name = "Cancel appointment", Exact = true }).ClickAsync();
        (await cancelled).Status.ShouldBe(200);
        await Expect(journey.Page.GetByText("Appointment cancelled", new() { Exact = true })).ToBeVisibleAsync();
        await Expect(details).ToHaveCountAsync(0);
        await Expect(block).ToHaveCountAsync(0);
        var history = await stack.GetAsync($"{stack.DealershipPath}/appointments?from={stack.Date}&to={stack.Date}&status=Cancelled");
        history.AsArray().ShouldContain(a => a!.String("id") == appointment.String("id") && a!.String("status") == "Cancelled");
        (await stack.GetAsync($"/api/v1/appointments/{appointment.String("id")}")).String("cancellationReason").ShouldBe(customer.Notes);
        (await stack.ScheduleAsync()).Appointments().ShouldNotContain(a => a.String("id") == appointment.String("id"));
    });

    [Fact]
    public Task Appointments_filters_narrow_the_day_and_survive_a_reload() => Run(nameof(Appointments_filters_narrow_the_day_and_survive_a_reload), async journey =>
    {
        var customer = Customer.Unique();
        await stack.BookAsync(customer: customer);
        await journey.Page.GotoAsync(stack.PageUrl("/appointments"));
        await Expect(journey.Page.GetByRole(AriaRole.Row).Filter(new() { HasText = customer.Name })).ToBeVisibleAsync();
        await journey.Page.GetByRole(AriaRole.Searchbox, new() { Name = "Search appointments", Exact = true }).FillAsync(customer.Name);
        await journey.Page.GetByRole(AriaRole.Button, new() { Name = "Status filter", Exact = true }).ClickAsync();
        await journey.Page.GetByRole(AriaRole.Checkbox, new() { NameRegex = new Regex("^Confirmed ") }).ClickAsync();
        await journey.Page.Keyboard.PressAsync("Escape");
        await Expect(journey.Page.GetByRole(AriaRole.Row).Filter(new() { HasText = "E2E " })).ToHaveCountAsync(1);
        await Expect(journey.Page).ToHaveURLAsync(new Regex(".*status.*"));
        var url = journey.Page.Url;
        await journey.Page.ReloadAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Searchbox, new() { Name = "Search appointments", Exact = true })).ToHaveValueAsync(customer.Name);
        await Expect(journey.Page.GetByRole(AriaRole.Row).Filter(new() { HasText = customer.Name })).ToHaveCountAsync(1);
        journey.Page.Url.ShouldBe(url);
        await journey.Page.GetByRole(AriaRole.Combobox, new() { Name = "Dealership", Exact = true }).ClickAsync();
        await journey.Page.GetByRole(AriaRole.Option, new() { NameRegex = new Regex("^Keyloop Autohaus") }).ClickAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Row).Filter(new() { HasText = customer.Name })).ToHaveCountAsync(0);
        await journey.Page.ReloadAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Combobox, new() { Name = "Dealership", Exact = true })).ToContainTextAsync("München");
    });

    [Fact]
    public Task Overview_day_counts_and_calendar_match_the_board() => Run(nameof(Overview_day_counts_and_calendar_match_the_board), async journey =>
    {
        var appointment = await stack.BookAsync();
        var appointments = (await stack.ScheduleAsync()).Appointments().ToArray();
        await journey.GotoBoardAsync();
        foreach (var item in appointments)
        {
            await Expect(BrowserJourney.Block(journey.Page, item)).ToBeVisibleAsync();
        }
        await journey.Page.GotoAsync(stack.PageUrl("/overview"));
        await journey.Page.GetByRole(AriaRole.Tab, new() { Name = "Table", Exact = true }).ClickAsync();
        var dayName = DateOnly.ParseExact(stack.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("ddd d MMM", CultureInfo.InvariantCulture);
        var dayLink = journey.Page.GetByRole(AriaRole.Link, new() { Name = dayName, Exact = true });
        var dayRow = journey.Page.GetByRole(AriaRole.Row).Filter(new() { Has = dayLink });
        await Expect(dayRow.GetByRole(AriaRole.Cell).Last).ToHaveTextAsync(appointments.Length.ToString(CultureInfo.InvariantCulture));
        await dayLink.ClickAsync();
        await Expect(BrowserJourney.Block(journey.Page, appointment)).ToBeVisibleAsync();
        await journey.Page.GotoAsync(stack.PageUrl("/calendar"));
        var calendarDayName = DateOnly.ParseExact(stack.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dddd d MMMM", CultureInfo.InvariantCulture);
        var calendarDay = journey.Page.GetByRole(AriaRole.Listitem).Filter(new() { Has = journey.Page.GetByRole(AriaRole.Heading, new() { Name = $"{calendarDayName}, dispatch board", Exact = true }) });
        foreach (var item in appointments)
        {
            await Expect(BrowserJourney.Block(calendarDay, item)).ToBeVisibleAsync();
        }
        await Expect(calendarDay.GetByRole(AriaRole.Button, new() { NameRegex = new Regex(@"\d\d:\d\d to \d\d:\d\d,") })).ToHaveCountAsync(appointments.Length);
        await BrowserJourney.Block(calendarDay, appointment).ClickAsync();
        var sheet = journey.Page.GetByRole(AriaRole.Dialog, new() { Name = "Interim Service", Exact = true });
        await Expect(sheet.GetByText(appointment["customer"]!.String("name"), new() { Exact = true })).ToBeVisibleAsync();
        await Expect(sheet.GetByText(appointment["vehicle"]!.String("vin"), new() { Exact = true })).ToBeVisibleAsync();
    });

    [Fact]
    public Task Electric_battery_work_offers_only_HV3_competence_and_explains_allocation() => Run(nameof(Electric_battery_work_offers_only_HV3_competence_and_explains_allocation), async journey =>
    {
        // Ben Okafor must be free at the start chosen, or the preference cannot be followed: a journey that ran first may hold
        // him at the day's first start (the Overview's Interim Service can be allocated to him), so take the first electric
        // start clear of his work.
        var schedule = await stack.ScheduleAsync();
        var ben = schedule["technicians"]!.AsArray().Single(t => t!.String("name") == "Ben Okafor")!.String("id");
        var busy = schedule.Appointments().Where(a => a["technician"]!.String("id") == ben).Select(a => (Start: Instant(a, "startUtc"), End: Instant(a, "endUtc"))).ToArray();
        var service = stack.Services.OfType<JsonObject>().Single(s => s.String("name") == "EV Battery Health Check");
        var slots = (await stack.GetAsync($"{stack.DealershipPath}/availability?serviceTypeId={service.String("id")}&date={stack.Date}&powertrain=BatteryElectric"))["slots"]!.AsArray().OfType<JsonObject>();
        var start = slots.First(slot => !busy.Any(work => Instant(slot, "startUtc") < work.End && Instant(slot, "endUtc") > work.Start)).String("startLocal")[11..16];
        await journey.GotoBoardAsync();
        var dialog = await journey.PrepareBookingAsync(Customer.Unique(), "EV Battery Health Check", electric: true, startLocal: start);
        await dialog.GetByRole(AriaRole.Combobox, new() { Name = "Preferred technician", Exact = true }).ClickAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Option)).ToHaveCountAsync(2);
        var names = await journey.Page.GetByRole(AriaRole.Option).AllTextContentsAsync();
        names.ShouldContain("Ben Okafor");
        names.ShouldNotContain("Amelia Clarke");
        names.ShouldNotContain("Chloe Nguyen");
        await journey.Page.GetByRole(AriaRole.Option, new() { Name = "Ben Okafor", Exact = true }).ClickAsync();
        var appointment = await journey.SubmitBookingAsync(dialog);
        appointment["technician"]!.String("name").ShouldBe("Ben Okafor");
        appointment["allocation"]!["minimumHvLevel"]!.GetValue<int>().ShouldBe(3);
        await BrowserJourney.Block(journey.Page, appointment).ClickAsync();
        var details = journey.Page.GetByRole(AriaRole.Complementary, new() { Name = "Appointment details", Exact = true });
        await Expect(details.GetByRole(AriaRole.Heading, new() { Name = "EV Battery Health Check", Exact = true })).ToBeVisibleAsync();
        // The Job card names the level the job needed; why this technician and bay is a disclosure under it.
        await Expect(details.GetByText("HV 3", new() { Exact = true })).ToBeVisibleAsync();
        await details.GetByRole(AriaRole.Button, new() { Name = "Why this allocation", Exact = true }).ClickAsync();
        var why = details.GetByRole(AriaRole.Region, new() { Name = "Why this allocation", Exact = true });
        await Expect(why).ToContainTextAsync("Ben Okafor");
        await Expect(why.GetByText(new Regex("HV 3")).First).ToBeVisibleAsync();
    });

    [Fact]
    public Task Confirmation_email_for_a_browser_booking_contains_the_time_and_no_free_text() => Run(nameof(Confirmation_email_for_a_browser_booking_contains_the_time_and_no_free_text), async journey =>
    {
        var customer = Customer.Unique();
        await journey.GotoBoardAsync();
        var appointment = await journey.SubmitBookingAsync(await journey.PrepareBookingAsync(customer));
        // This test repeats journey 2's browser booking with its own address, so test order is irrelevant.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        JsonObject? message = null;
        while (message is null)
        {
            var inbox = JsonNode.Parse(await stack.Mailpit.GetStringAsync("/api/v1/messages", deadline.Token))!;
            message = inbox["messages"]!.AsArray().OfType<JsonObject>().FirstOrDefault(m => m["To"]!.AsArray().Any(to => to!.String("Address") == customer.Email));
            if (message is null)
            {
                await Task.Delay(100, deadline.Token); // bounded condition polling, never a browser sleep
            }
        }
        var mail = JsonNode.Parse(await stack.Mailpit.GetStringAsync($"/api/v1/message/{message.String("ID")}", deadline.Token))!;
        mail.String("Subject").ShouldBe($"Booking confirmation - {Guid.Parse(appointment.String("id")).ToString("N")[^8..].ToUpperInvariant()}");
        var text = mail.String("Text");
        text.ShouldContain(appointment.String("startLocal")[11..16]);
        text.ShouldContain(appointment.String("endLocal")[11..16]);
        text.ShouldContain(DateOnly.ParseExact(stack.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dddd d MMMM yyyy", CultureInfo.InvariantCulture));
        var entire = mail.ToJsonString();
        entire.ShouldNotContain(customer.Name);
        entire.ShouldNotContain(customer.Notes);
    });

    [Fact]
    public Task Phone_agenda_opens_a_bottom_sheet_and_can_complete_a_booking() => BrowserJourney.RunAsync(stack, nameof(Phone_agenda_opens_a_bottom_sheet_and_can_complete_a_booking), async journey =>
    {
        var existing = await stack.BookAsync();
        await journey.GotoBoardAsync();
        await BrowserJourney.Block(journey.Page, existing).ClickAsync();
        var sheet = journey.Page.GetByRole(AriaRole.Dialog, new() { Name = "Interim Service", Exact = true });
        await Expect(sheet).ToHaveAttributeAsync("data-side", "bottom");
        await Expect(sheet.GetByText(existing["customer"]!.String("name"), new() { Exact = true })).ToBeVisibleAsync();
        // The same cards as the docked details, and the action row pinned above the home indicator.
        await Expect(sheet.GetByRole(AriaRole.Heading, new() { Name = "Vehicle", Exact = true })).ToBeAttachedAsync();
        await Expect(sheet.GetByRole(AriaRole.Button, new() { Name = "Cancel booking…", Exact = true })).ToBeInViewportAsync();
        await sheet.GetByRole(AriaRole.Button, new() { Name = "Close", Exact = true }).ClickAsync();
        var booked = await journey.SubmitBookingAsync(await journey.PrepareBookingAsync(Customer.Unique()));
        await journey.Page.GetByRole(AriaRole.Button, new() { Name = "View on board", Exact = true }).ClickAsync();
        await Expect(BrowserJourney.Block(journey.Page, booked)).ToBeVisibleAsync();
        (await journey.Page.EvaluateAsync<bool>("document.documentElement.scrollWidth <= innerWidth")).ShouldBeTrue("no horizontal page overflow at 390px");
    }, mobile: true);

    [Fact]
    public Task Dark_theme_persists_and_each_main_page_has_a_screenshot() => Run(nameof(Dark_theme_persists_and_each_main_page_has_a_screenshot), async journey =>
    {
        await journey.GotoBoardAsync();
        await journey.Page.GetByRole(AriaRole.Button, new() { Name = "Switch to dark mode", Exact = true }).ClickAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Button, new() { Name = "Switch to light mode", Exact = true })).ToBeVisibleAsync();
        await journey.Page.ReloadAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Button, new() { Name = "Switch to light mode", Exact = true })).ToBeVisibleAsync();
        foreach (var (path, heading) in new[] { ("/dispatch", "Dispatch board"), ("/appointments", "Appointments"), ("/overview", "Overview"), ("/calendar", "Calendar"), ("/resources/technicians", "Technicians"), ("/resources/bays", "Bays"), ("/resources/services", "Services"), ("/resources/policy", "Requirement policy"), ("/resources/history", "Change history"), ("/settings/appearance", "Appearance"), ("/settings/account", "Account") })
        {
            await journey.Page.GotoAsync(stack.PageUrl(path));
            await Expect(journey.Page.GetByRole(AriaRole.Heading, new() { Name = heading, Exact = true }).First).ToBeVisibleAsync();
            await Expect(journey.Page.GetByRole(AriaRole.Button, new() { Name = "Switch to light mode", Exact = true })).ToBeVisibleAsync();
            await journey.Page.ScreenshotAsync(new() { Path = Path.Combine(journey.DirectoryPath, $"dark-{path.Trim('/').Replace('/', '-')}.png"), FullPage = true });
        }
    });

    private Task Run(string name, Func<BrowserJourney, Task> test) => BrowserJourney.RunAsync(stack, name, test);
    private static DateTimeOffset Instant(JsonObject item, string property) => DateTimeOffset.Parse(item.String(property), CultureInfo.InvariantCulture);
    private async Task AssertBookedAsync(BrowserJourney journey, JsonObject appointment, Customer customer)
    {
        await Expect(journey.Page.GetByText("Booked", new() { Exact = true })).ToBeVisibleAsync();
        await Expect(journey.Page.GetByText(new Regex($"{Regex.Escape(appointment["bay"]!.String("name"))}.*{Regex.Escape(appointment["technician"]!.String("name"))}")).First).ToBeVisibleAsync();
        await Expect(BrowserJourney.Block(journey.Page, appointment)).ToBeVisibleAsync();
        var record = await stack.GetAsync($"/api/v1/appointments/{appointment.String("id")}");
        record["customer"]!.String("name").ShouldBe(customer.Name);
        record["customer"]!.String("email").ShouldBe(customer.Email);
        record.String("startUtc").ShouldBe(appointment.String("startUtc"));
    }
}

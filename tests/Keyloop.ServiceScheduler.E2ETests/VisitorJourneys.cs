namespace Keyloop.ServiceScheduler.E2ETests;

[Collection(SchedulerCollection.Name)]
[Trait("Category", "E2E")]
public sealed class VisitorJourneys(VisitorStack stack) : IClassFixture<VisitorStack>
{
    [Fact]
    public Task Signed_out_visitors_see_masked_work_and_cannot_book_or_open_Admin() => BrowserJourney.RunAsync(stack, nameof(Signed_out_visitors_see_masked_work_and_cannot_book_or_open_Admin), async journey =>
    {
        (await stack.GetAsync("/api/v1/me"))["authenticated"]!.GetValue<bool>().ShouldBeFalse();
        var schedule = await stack.ScheduleAsync();
        var appointment = schedule.Appointments().First();
        appointment.String("vin").ShouldStartWith("***********");
        appointment.String("registration").ShouldBe("*******");
        appointment.String("customerName").ShouldMatch("^[A-Z]+$");
        await journey.GotoBoardAsync();
        await BrowserJourney.Block(journey.Page, appointment).ClickAsync();
        var sheet = journey.Page.GetByRole(AriaRole.Dialog, new() { Name = appointment["serviceType"]!.String("name"), Exact = true });
        await Expect(sheet.GetByText(appointment.String("vin"), new() { Exact = true })).ToBeVisibleAsync();
        await Expect(sheet.GetByText(appointment.String("customerName"), new() { Exact = true })).ToBeVisibleAsync();
        await Expect(sheet.GetByRole(AriaRole.Textbox, new() { Name = "Reason", Exact = true })).ToHaveCountAsync(0);
        await sheet.GetByRole(AriaRole.Button, new() { Name = "Close", Exact = true }).ClickAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Link, new() { Name = "Requirement policy", Exact = true })).ToHaveCountAsync(0);
        await Expect(journey.Page.GetByRole(AriaRole.Link, new() { Name = "Change history", Exact = true })).ToHaveCountAsync(0);
        var bookingPosts = 0;
        journey.Page.Request += (_, request) => { if (request.Method == "POST" && request.Url.EndsWith("/appointments", StringComparison.Ordinal)) { bookingPosts++; } };
        // The shipped visitor action offers sign-in, never the booking form (UI_DESIGN 11.20).
        await journey.Page.GetByRole(AriaRole.Button, new() { Name = "Book appointment", Exact = true }).ClickAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Dialog, new() { Name = "Sign in to book", Exact = true })).ToBeVisibleAsync();
        await Expect(journey.Page.GetByRole(AriaRole.Dialog, new() { Name = "Book appointment", Exact = true })).ToHaveCountAsync(0);
        bookingPosts.ShouldBe(0);
        foreach (var path in new[] { "/resources/technicians", "/resources/policy" })
        {
            await journey.Page.GotoAsync(stack.PageUrl(path));
            await Expect(journey.Page.GetByRole(AriaRole.Heading, new() { Name = "Sign in to continue", Exact = true })).ToBeVisibleAsync();
            await Expect(journey.Page.GetByRole(AriaRole.Button, new() { Name = "Add technician", Exact = true })).ToHaveCountAsync(0);
        }
    });
}

using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

/// <summary>
/// The fixed confirmation and cancellation content (SYSTEM_DESIGN §8.9). Rendering happens at dispatch, never inside the booking or
/// cancel transaction, and a render failure only fails its outbox row; these tests also pin that the renderer is total over every
/// seeded zone, both daylight-saving changes and the longest values the domain accepts.
/// </summary>
public sealed class NotificationTemplateTests
{
    private static readonly Guid AppointmentId = Guid.Parse("01234567-89ab-7cde-8fab-0123456789ab");
    private static readonly DateTime FallBackStart = new(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime FallBackEnd = new(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc);

    private static NotificationDetails Details(
        string zone = "Europe/London", DateTime? startUtc = null, DateTime? endUtc = null, string recipient = "jane@inbox.keyloop.local",
        string dealership = "Test Motors", string service = "Interim service", string registration = "AB12 CDE") =>
        new(AppointmentId, recipient, dealership, service, zone, startUtc ?? FallBackStart, endUtc ?? FallBackEnd, registration, "3456");

    [Theory]
    [InlineData(NotificationKind.BookingConfirmation, "Booking confirmation", "Your service booking is confirmed.")]
    [InlineData(NotificationKind.Cancellation, "Booking cancelled", "Your service booking has been cancelled.")]
    public void Contains_the_booking_details_in_both_parts(NotificationKind kind, string subject, string statusLine)
    {
        var message = NotificationTemplate.Render(Guid.NewGuid(), kind, Details());

        message.Subject.ShouldBe($"{subject} - 456789AB");
        message.Recipient.ShouldBe("jane@inbox.keyloop.local");
        foreach (var value in new[] { "Test Motors", "Interim service", "456789AB", AppointmentId.ToString(), "AB12 CDE", "*************3456",
            "contact the dealership", statusLine })
        {
            message.TextBody.ShouldContain(value);
            message.HtmlBody.ShouldContain(value);
        }
        message.TextBody.ShouldNotContain("WVWZZZ1KZAW123456");
        message.HtmlBody.ShouldNotContain("WVWZZZ1KZAW123456");
        message.HtmlBody.ShouldContain("lang=\"en-GB\"");
        message.HtmlBody.ShouldContain("<h1");
        message.HtmlBody.ShouldContain("<dl>");
        message.HtmlBody.ShouldNotContain("<img");
        message.HtmlBody.ShouldNotContain("<style");
        message.HtmlBody.ShouldNotContain("https://");
        message.TextBody.ShouldNotContain("Time zone:", Case.Sensitive);
    }

    [Fact]
    public void The_cancellation_notice_has_no_reason_field()
    {
        // The reason is typed by an anonymous visitor (ADR-010) and could aim a link at any address, so it is not part of the
        // details at all (proposal 2.4); the notice says only that the booking was cancelled. NotificationOutboxTests and
        // NotificationDispatcherTests prove the reason is in neither the stored snapshot nor the sent email.
        var message = NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.Cancellation, Details());

        foreach (var body in new[] { message.Subject, message.TextBody, message.HtmlBody })
        {
            body.ShouldNotContain("reason", Case.Insensitive);
        }
        message.TextBody.ShouldContain("Your service booking has been cancelled.");
    }

    public static TheoryData<string, DateTime, DateTime, string, string> DaylightSavingDays => new()
    {
        // Every seeded zone (DemoDataSeeder: Reading, München), on both changes of 2026; each line carries its own offset.
        { "Europe/London", new(2026, 3, 29, 0, 30, 0, DateTimeKind.Utc), new(2026, 3, 29, 1, 30, 0, DateTimeKind.Utc),
            "Sunday 29 March 2026, 00:30 (UTC+00:00, Europe/London)", "Sunday 29 March 2026, 02:30 (UTC+01:00, Europe/London)" },
        { "Europe/London", new(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc), new(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc),
            "Sunday 25 October 2026, 01:30 (UTC+01:00, Europe/London)", "Sunday 25 October 2026, 01:30 (UTC+00:00, Europe/London)" },
        { "Europe/Berlin", new(2026, 3, 29, 0, 30, 0, DateTimeKind.Utc), new(2026, 3, 29, 1, 30, 0, DateTimeKind.Utc),
            "Sunday 29 March 2026, 01:30 (UTC+01:00, Europe/Berlin)", "Sunday 29 March 2026, 03:30 (UTC+02:00, Europe/Berlin)" },
        { "Europe/Berlin", new(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc), new(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc),
            "Sunday 25 October 2026, 02:30 (UTC+02:00, Europe/Berlin)", "Sunday 25 October 2026, 02:30 (UTC+01:00, Europe/Berlin)" },
        { "Europe/London", new(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc), new(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc),
            "Tuesday 13 October 2026, 09:00 (UTC+01:00, Europe/London)", "Tuesday 13 October 2026, 10:00 (UTC+01:00, Europe/London)" },
    };

    [Theory]
    [MemberData(nameof(DaylightSavingDays))]
    public void Local_times_are_human_readable_british_english_with_the_offset_of_each_instant(
        string zone, DateTime startUtc, DateTime endUtc, string start, string end)
    {
        var message = NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.BookingConfirmation, Details(zone, startUtc, endUtc));

        foreach (var body in new[] { message.TextBody, message.HtmlBody })
        {
            body.ShouldContain(start);
            body.ShouldContain(end);
        }
        message.TextBody.ShouldContain($"Start: {start}");
        message.TextBody.ShouldContain($"End: {end}");
    }

    [Fact]
    public void Renders_the_longest_values_the_domain_accepts()
    {
        var recipient = new string('j', 243) + "@inbox.local"; // 254 characters, the domain maximum
        var details = Details(recipient: recipient, dealership: new string('D', 200), service: new string('S', 120), registration: new string('R', 16));

        var message = NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.Cancellation, details);

        message.Recipient.ShouldBe(recipient);
        message.TextBody.ShouldContain(new string('D', 200));
        message.TextBody.ShouldContain(new string('S', 120));
        message.TextBody.ShouldContain(new string('R', 16));
        message.Subject.Length.ShouldBeLessThanOrEqualTo(200, "the subject has no free-length value in it");
    }

    [Fact]
    public void Html_encodes_every_dynamic_field()
    {
        var details = Details(dealership: "<script>bad</script>", service: "Oil & filter", registration: "<b>AB12</b>");
        var message = NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.Cancellation, details);
        foreach (var field in new[] { details.DealershipName, details.ServiceName, details.Registration })
        {
            message.TextBody.ShouldContain(field);
            message.HtmlBody.ShouldNotContain(field);
            message.HtmlBody.ShouldContain(System.Net.WebUtility.HtmlEncode(field));
        }
    }

    [Fact]
    public void Rejects_an_unknown_time_zone_so_the_dispatcher_can_fail_only_that_row() =>
        Should.Throw<TimeZoneNotFoundException>(() => NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.BookingConfirmation, Details("Mars/Olympus_Mons")));
}

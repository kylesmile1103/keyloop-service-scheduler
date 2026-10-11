using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

public sealed class NotificationTemplateTests
{
    private static readonly Guid AppointmentId = Guid.Parse("01234567-89ab-7cde-8fab-0123456789ab");
    private static NotificationDetails Details => new(AppointmentId, "jane@example.com", "Test Motors", "Interim service", "Europe/London",
        new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc), new DateTime(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc),
        "AB12 CDE", "WVWZZZ1KZAW123456", "Customer rescheduled");

    [Theory]
    [InlineData(NotificationKind.BookingConfirmation, "Booking confirmation", "confirmed")]
    [InlineData(NotificationKind.Cancellation, "Booking cancelled", "cancelled")]
    public void Contains_booking_details_and_distinct_offsets_across_the_repeated_hour(NotificationKind kind, string subject, string status)
    {
        var message = NotificationTemplate.Render(Guid.NewGuid(), kind, Details);
        message.Subject.ShouldBe($"{subject} - 456789AB");
        foreach (var value in new[] { "Test Motors", "Interim service", "2026-10-25T01:30+01:00", "2026-10-25T01:30+00:00",
            "Europe/London", "456789AB", AppointmentId.ToString(), "AB12 CDE", "*************3456", "contact the dealership", status })
        {
            message.TextBody.ShouldContain(value);
            message.HtmlBody.ShouldContain(value);
        }
        message.TextBody.ShouldNotContain(Details.Vin);
        message.HtmlBody.ShouldNotContain(Details.Vin);
        message.HtmlBody.ShouldContain("lang=\"en-GB\"");
        message.HtmlBody.ShouldContain("<h1");
        message.HtmlBody.ShouldContain("<dl>");
        message.HtmlBody.ShouldNotContain("<img");
        message.HtmlBody.ShouldNotContain("<style");
        message.HtmlBody.ShouldNotContain("https://");
        if (kind == NotificationKind.Cancellation)
        {
            message.TextBody.ShouldContain(Details.CancellationReason!);
            message.HtmlBody.ShouldContain(Details.CancellationReason!);
        }
        else
        {
            message.TextBody.ShouldNotContain(Details.CancellationReason!);
            message.HtmlBody.ShouldNotContain(Details.CancellationReason!);
        }
    }

    [Fact]
    public void Html_encodes_every_user_supplied_field()
    {
        var details = Details with { DealershipName = "<script>bad</script>", ServiceName = "Oil & filter", Registration = "<b>AB12</b>", CancellationReason = "<img src=x onerror='alert(1)'>" };
        var message = NotificationTemplate.Render(Guid.NewGuid(), NotificationKind.Cancellation, details);
        foreach (var field in new[] { details.DealershipName, details.ServiceName, details.Registration, details.CancellationReason })
        {
            message.TextBody.ShouldContain(field!);
            message.HtmlBody.ShouldNotContain(field!);
            message.HtmlBody.ShouldContain(System.Net.WebUtility.HtmlEncode(field!));
        }
    }

    [Theory]
    [InlineData("jane@example.com", "j***@example.com")]
    [InlineData("j@example.com", "j***@example.com")]
    [InlineData("jane+secret@example.com", "j***@example.com")]
    [InlineData("invalid", "***")]
    [InlineData("jane@example.com\r\nBcc: victim@secret.com", "***")]
    public void Recipient_is_masked(string input, string expected) => NotificationTemplate.MaskRecipient(input).ShouldBe(expected);

    [Fact]
    public void Message_id_is_stable_for_the_outbox_id()
    {
        new EmailMessage(AppointmentId, "jane@example.com", "subject", "text", "html").MessageId
            .ShouldBe("0123456789ab7cde8fab0123456789ab@service-scheduler.keyloop.example");
    }
}

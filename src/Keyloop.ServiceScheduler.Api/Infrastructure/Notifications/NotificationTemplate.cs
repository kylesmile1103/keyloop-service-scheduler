using System.Net;
using System.Text;
using MimeKit;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

/// <summary>Fixed, accessible multipart content. Snapshotted before commit; no runtime template compiler or external assets.</summary>
public static class NotificationTemplate
{
    public static EmailMessage Render(Guid outboxId, NotificationKind kind, NotificationDetails details)
    {
        ArgumentNullException.ThrowIfNull(details);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(details.TimeZoneId);
        var reference = details.AppointmentId.ToString("N")[^8..].ToUpperInvariant();
        var heading = kind switch
        {
            NotificationKind.BookingConfirmation => "Booking confirmation",
            NotificationKind.Cancellation => "Booking cancelled",
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var introduction = kind == NotificationKind.BookingConfirmation ? "Your service booking is confirmed." : "Your service booking has been cancelled.";
        const string support = "For help with your booking, please contact the dealership and quote your booking reference.";
        (string Label, string Value)[] fields =
        [
            ("Dealership", details.DealershipName),
            ("Service", details.ServiceName),
            ("Start", LocalTimeConverter.FormatLocal(details.StartUtc, zone)),
            ("End", LocalTimeConverter.FormatLocal(details.EndUtc, zone)),
            ("Time zone", details.TimeZoneId),
            ("Booking reference", reference),
            ("Full appointment id", details.AppointmentId.ToString("D")),
            ("Vehicle registration", details.Registration),
            ("VIN", new string('*', details.Vin.Length - 4) + details.Vin[^4..]),
        ];
        var text = new StringBuilder().AppendLine("Keyloop Service Scheduler").AppendLine().AppendLine(heading).AppendLine(introduction).AppendLine();
        var html = new StringBuilder("<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>")
            .Append(WebUtility.HtmlEncode(heading)).Append("</title></head><body style=\"font-family:Arial,sans-serif;color:#17202a;background:#ffffff;line-height:1.6\"><main style=\"max-width:640px;margin:0 auto;padding:24px\"><p>Keyloop Service Scheduler</p><h1 style=\"font-size:24px\">")
            .Append(WebUtility.HtmlEncode(heading)).Append("</h1><p>").Append(introduction).Append("</p><dl>");
        foreach (var field in fields)
        {
            AppendField(field.Label, field.Value);
        }
        if (kind == NotificationKind.Cancellation)
        {
            AppendField("Cancellation reason", details.CancellationReason ?? string.Empty);
        }
        text.AppendLine().AppendLine(support);
        html.Append("</dl><p>").Append(support).Append("</p></main></body></html>");
        return new EmailMessage(outboxId, details.Recipient, $"{heading} - {reference}", text.ToString(), html.ToString());

        void AppendField(string label, string value)
        {
            text.Append(label).Append(": ").AppendLine(value);
            html.Append("<dt style=\"font-weight:bold\">").Append(WebUtility.HtmlEncode(label))
                .Append("</dt><dd style=\"margin:0 0 12px;white-space:pre-wrap\">").Append(WebUtility.HtmlEncode(value)).Append("</dd>");
        }
    }

    public static string MaskRecipient(string recipient)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(recipient);
        if (recipient.Contains('\r') || recipient.Contains('\n') || !MailboxAddress.TryParse(recipient, out var mailbox) || mailbox.Address != recipient)
        {
            return "***";
        }
        var at = recipient.LastIndexOf('@');
        return at > 0 ? $"{recipient[0]}***{recipient[at..]}" : "***";
    }
}

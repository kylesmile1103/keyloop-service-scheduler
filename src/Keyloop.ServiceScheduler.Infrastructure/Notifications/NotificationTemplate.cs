using System.Globalization;
using System.Net;
using System.Text;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Fixed, accessible multipart content in British English. Rendered at dispatch, so a failure (for example an unknown time zone) fails
/// only its outbox row, never a booking or cancel (SYSTEM_DESIGN §8.9). No runtime template compiler, external assets or tracking. Every
/// value is one the recipient gave or the dealership configured: no visitor-typed free text (proposal 2.4).
/// </summary>
internal static class NotificationTemplate
{
    private const string Support = "For help with your booking, please contact the dealership and quote your booking reference.";

    public static EmailMessage Render(Guid notificationId, NotificationKind kind, NotificationDetails details)
    {
        ArgumentNullException.ThrowIfNull(details);
        var (heading, introduction) = kind switch
        {
            NotificationKind.BookingConfirmation => ("Booking confirmation", "Your service booking is confirmed."),
            NotificationKind.Cancellation => ("Booking cancelled", "Your service booking has been cancelled."),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var zone = TimeZoneInfo.FindSystemTimeZoneById(details.TimeZoneId);
        // The UUID's random suffix: version-7 ids made close together share their time prefix.
        var reference = details.AppointmentId.ToString("N")[^8..].ToUpperInvariant();
        (string Label, string Value)[] fields =
        [
            ("Dealership", details.DealershipName),
            ("Service", details.ServiceName),
            ("Start", FormatLocal(details.StartUtc, zone, details.TimeZoneId)),
            ("End", FormatLocal(details.EndUtc, zone, details.TimeZoneId)),
            ("Booking reference", reference),
            ("Full appointment id", details.AppointmentId.ToString("D")),
            ("Vehicle registration", details.Registration),
            ("VIN", "*************" + details.VinLastFour),
        ];
        var text = new StringBuilder().AppendLine("Keyloop Service Scheduler").AppendLine().AppendLine(heading).AppendLine(introduction).AppendLine();
        var html = new StringBuilder("<!doctype html><html lang=\"en-GB\"><head><meta charset=\"utf-8\"><title>")
            .Append(WebUtility.HtmlEncode(heading))
            .Append("</title></head><body style=\"font-family:Arial,sans-serif;font-size:16px;color:#17202a;background:#ffffff;line-height:1.6\">")
            .Append("<main style=\"max-width:640px;margin:0 auto;padding:24px\"><p>Keyloop Service Scheduler</p><h1 style=\"font-size:24px\">")
            .Append(WebUtility.HtmlEncode(heading)).Append("</h1><p>").Append(WebUtility.HtmlEncode(introduction)).Append("</p><dl>");
        foreach (var (label, value) in fields)
        {
            text.Append(label).Append(": ").AppendLine(value);
            html.Append("<dt style=\"font-weight:bold\">").Append(WebUtility.HtmlEncode(label))
                .Append("</dt><dd style=\"margin:0 0 12px\">").Append(WebUtility.HtmlEncode(value)).Append("</dd>");
        }
        text.AppendLine().AppendLine(Support);
        html.Append("</dl><p>").Append(WebUtility.HtmlEncode(Support)).Append("</p></main></body></html>");
        return new EmailMessage(notificationId, details.Recipient, $"{heading} - {reference}", text.ToString(), html.ToString());
    }

    /// <summary>
    /// <c>Tuesday 13 October 2026, 09:00 (UTC+01:00, Europe/London)</c>: the instant's own offset, so the two 01:30s of an autumn
    /// change differ. The invariant culture's names are English and its digits fixed, so server culture never leaks in.
    /// </summary>
    internal static string FormatLocal(DateTime utc, TimeZoneInfo zone, string zoneId)
    {
        // A DateTimeOffset, not a DateTime: "zzz" on a DateTime formats the machine's offset, not the zone's.
        var local = TimeZoneInfo.ConvertTime(new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)), zone);
        return string.Create(CultureInfo.InvariantCulture, $"{local:dddd d MMMM yyyy, HH:mm} (UTC{local:zzz}, {zoneId})");
    }
}

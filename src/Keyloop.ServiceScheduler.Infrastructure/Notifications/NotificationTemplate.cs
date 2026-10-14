using System.Globalization;
using System.Net;
using System.Text;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Renders fixed, accessible multipart email content in British English at dispatch time: plain text built here and HTML from
/// the embedded MJML build (Templates/Notification.mjml), so the layout survives Outlook, Gmail and phone clients.
/// </summary>
internal static class NotificationTemplate
{
    private const string Support = "For help with your booking, please contact the dealership and quote your booking reference.";
    private const string TemplateResource = "Keyloop.ServiceScheduler.Infrastructure.Notifications.Templates.Notification.html";
    private static readonly string HtmlTemplate = LoadTemplate();

    private static string LoadTemplate()
    {
        using var stream = typeof(NotificationTemplate).Assembly.GetManifestResourceStream(TemplateResource)
            ?? throw new InvalidOperationException($"Embedded email template '{TemplateResource}' is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }

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
        foreach (var (label, value) in fields)
        {
            text.Append(label).Append(": ").AppendLine(value);
        }
        text.AppendLine().AppendLine(Support);

        // The HTML part is the MJML build (Templates/Notification.html): responsive table layout with inline styles, no images,
        // no external assets. Every dynamic value is HTML-encoded; the status colours are fixed per kind.
        var (statusLabel, statusBackground, statusForeground) = kind == NotificationKind.BookingConfirmation
            ? ("Confirmed", "#d8fdeb", "#007653")
            : ("Cancelled", "#fdecec", "#bb061e");
        var html = new StringBuilder(HtmlTemplate)
            .Replace("{{Heading}}", WebUtility.HtmlEncode(heading))
            .Replace("{{PreviewText}}", WebUtility.HtmlEncode($"{details.ServiceName} at {details.DealershipName}, {fields[2].Value}"))
            .Replace("{{Introduction}}", WebUtility.HtmlEncode(introduction))
            .Replace("{{StatusLabel}}", statusLabel)
            .Replace("{{StatusBg}}", statusBackground)
            .Replace("{{StatusFg}}", statusForeground)
            .Replace("{{Service}}", WebUtility.HtmlEncode(details.ServiceName))
            .Replace("{{Start}}", WebUtility.HtmlEncode(fields[2].Value))
            .Replace("{{End}}", WebUtility.HtmlEncode(fields[3].Value))
            .Replace("{{Dealership}}", WebUtility.HtmlEncode(details.DealershipName))
            .Replace("{{Registration}}", WebUtility.HtmlEncode(details.Registration))
            .Replace("{{Vin}}", WebUtility.HtmlEncode(fields[7].Value))
            .Replace("{{Reference}}", WebUtility.HtmlEncode(reference))
            .Replace("{{AppointmentId}}", WebUtility.HtmlEncode(details.AppointmentId.ToString("D")))
            .Replace("{{Support}}", WebUtility.HtmlEncode(Support));
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

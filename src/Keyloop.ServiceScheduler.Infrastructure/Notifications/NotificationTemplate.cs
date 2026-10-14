using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Renders fixed, accessible multipart email content in British English at dispatch time: plain text built here and HTML from
/// the embedded MJML build (Templates/Notification.mjml), so the layout survives Outlook, Gmail and phone clients.
/// </summary>
internal static partial class NotificationTemplate
{
    private const string Support = "For help with your booking, please contact the dealership and quote your booking reference.";
    private const string TemplateResource = "Keyloop.ServiceScheduler.Infrastructure.Notifications.Templates.Notification.html";
    private static readonly string HtmlTemplate = LoadTemplate();

    private static string LoadTemplate()
    {
        using var stream = typeof(NotificationTemplate).Assembly.GetManifestResourceStream(TemplateResource)
            ?? throw new InvalidOperationException($"Embedded email template '{TemplateResource}' is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        // Trimmed: a line ending here would be rewritten in transit (SMTP uses CRLF) and break the byte-for-byte round trip.
        return reader.ReadToEnd().Trim();
    }

    public static EmailMessage Render(Guid notificationId, NotificationKind kind, NotificationDetails details)
    {
        ArgumentNullException.ThrowIfNull(details);
        var (heading, introduction, statusLabel, statusBackground, statusForeground) = kind switch
        {
            NotificationKind.BookingConfirmation => ("Booking confirmation", "Your service booking is confirmed.", "Confirmed", "#d8fdeb", "#007653"),
            NotificationKind.Cancellation => ("Booking cancelled", "Your service booking has been cancelled.", "Cancelled", "#fdecec", "#bb061e"),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var zone = TimeZoneInfo.FindSystemTimeZoneById(details.TimeZoneId);
        // The UUID's random suffix: version-7 ids made close together share their time prefix.
        var reference = details.AppointmentId.ToString("N")[^8..].ToUpperInvariant();
        var appointmentId = details.AppointmentId.ToString("D");
        var start = FormatLocal(details.StartUtc, zone, details.TimeZoneId);
        var end = FormatLocal(details.EndUtc, zone, details.TimeZoneId);
        var maskedVin = "*************" + details.VinLastFour;
        (string Label, string Value)[] fields =
        [
            ("Dealership", details.DealershipName),
            ("Service", details.ServiceName),
            ("Start", start),
            ("End", end),
            ("Booking reference", reference),
            ("Full appointment id", appointmentId),
            ("Vehicle registration", details.Registration),
            ("VIN", maskedVin),
        ];
        var text = new StringBuilder().AppendLine("Keyloop Service Scheduler").AppendLine().AppendLine(heading).AppendLine(introduction).AppendLine();
        foreach (var (label, value) in fields)
        {
            text.Append(label).Append(": ").AppendLine(value);
        }
        text.AppendLine().AppendLine(Support);

        // The HTML part is the MJML build (Templates/Notification.html): a responsive table layout with inline styles and MJML's own
        // embedded responsive stylesheet, no images and no external assets. Every dynamic value is HTML-encoded; the status colours
        // are fixed per kind. The placeholders are filled in a single pass, so a value that happens to read "{{Support}}" stays
        // literal instead of being expanded by a later substitution.
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Heading"] = WebUtility.HtmlEncode(heading),
            ["PreviewText"] = WebUtility.HtmlEncode($"{details.ServiceName} at {details.DealershipName}, {start}"),
            ["Introduction"] = WebUtility.HtmlEncode(introduction),
            ["StatusLabel"] = statusLabel,
            ["StatusBg"] = statusBackground,
            ["StatusFg"] = statusForeground,
            ["Service"] = WebUtility.HtmlEncode(details.ServiceName),
            ["Start"] = WebUtility.HtmlEncode(start),
            ["End"] = WebUtility.HtmlEncode(end),
            ["Dealership"] = WebUtility.HtmlEncode(details.DealershipName),
            ["Registration"] = WebUtility.HtmlEncode(details.Registration),
            ["Vin"] = WebUtility.HtmlEncode(maskedVin),
            ["Reference"] = WebUtility.HtmlEncode(reference),
            ["AppointmentId"] = WebUtility.HtmlEncode(appointmentId),
            ["Support"] = WebUtility.HtmlEncode(Support),
        };
        var html = Placeholder().Replace(HtmlTemplate, match => values.TryGetValue(match.Groups[1].Value, out var value)
            ? value
            : throw new InvalidOperationException($"The email template has no value for the placeholder {match.Value}."));
        return new EmailMessage(notificationId, details.Recipient, $"{heading} - {reference}", text.ToString(), html);
    }

    /// <summary>A template placeholder such as <c>{{Reference}}</c>; source-generated, so no runtime regex construction.</summary>
    [GeneratedRegex(@"\{\{([A-Za-z]+)\}\}")]
    private static partial Regex Placeholder();

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

using MimeKit;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Suppresses delivery to RFC 2606 / RFC 6761 reserved domains (<c>example.com</c>, <c>example.net</c>, <c>example.org</c>,
/// <c>.example</c>, <c>.test</c>, <c>.invalid</c>, <c>.localhost</c>).
/// </summary>
internal static class RecipientPolicy
{
    private static readonly string[] ReservedDomains = ["example.com", "example.net", "example.org"];
    private static readonly string[] ReservedTopLevelNames = ["example", "test", "invalid", "localhost"];

    public static bool IsReservedDomain(string recipient)
    {
        ArgumentNullException.ThrowIfNull(recipient);
        // Both readings of the address: the text after the last '@', and the mailbox a provider would parse (display-name forms such
        // as "Jane <jane@example.com>" pass the booking validator's single-'@' rule).
        var at = recipient.LastIndexOf('@');
        if (at >= 0 && IsReservedName(recipient[(at + 1)..]))
        {
            return true;
        }
        return MailboxAddress.TryParse(recipient, out var mailbox) && IsReservedName(mailbox.Domain);
    }

    private static bool IsReservedName(string domain)
    {
        var name = domain.Trim().TrimEnd('>').TrimEnd().TrimEnd('.').ToLowerInvariant();
        if (name.Length == 0)
        {
            return false;
        }
        foreach (var reserved in ReservedDomains)
        {
            if (name == reserved || name.EndsWith("." + reserved, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return ReservedTopLevelNames.Contains(name[(name.LastIndexOf('.') + 1)..]);
    }
}

using MimeKit;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// The fixed, non-configurable part of the recipient policy (proposal §2.6): names reserved for documentation and testing are never sent
/// to, so seeded and test data (every demo customer is <c>@example.com</c>) never produce real email, bounces or billable sends.
/// Reserved: <c>example.com</c>, <c>example.net</c>, <c>example.org</c> and their subdomains, and anything under the <c>example</c>,
/// <c>test</c>, <c>invalid</c> and <c>localhost</c> top-level names (RFC 2606, RFC 6761), case-insensitively. Configurable modes and
/// daily caps are Task 20's. Applied when a row is staged (inside the booking or cancel's SaveChanges, so it must never throw) and again
/// at claim for a Pending row that predates that rule.
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

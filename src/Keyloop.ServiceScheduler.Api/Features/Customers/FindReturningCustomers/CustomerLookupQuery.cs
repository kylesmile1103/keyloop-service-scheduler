namespace Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

internal enum CustomerLookupKind { Email, Phone, RegistrationOrName }

/// <summary>Shape classification and literal LIKE escaping. Never format this input into logs or SQL text.</summary>
internal static class CustomerLookupQuery
{
    internal static CustomerLookupKind Kind(string query)
    {
        if (query.Contains('@', StringComparison.Ordinal))
        {
            return CustomerLookupKind.Email;
        }
        var digits = query.Count(char.IsAsciiDigit);
        return digits >= 6 && digits > query.Length - digits
            && query.All(c => char.IsAsciiDigit(c) || char.IsWhiteSpace(c) || c is '+' or '(' or ')' or '-')
            ? CustomerLookupKind.Phone : CustomerLookupKind.RegistrationOrName;
    }

    internal static string Digits(string value) => string.Concat(value.Where(char.IsAsciiDigit));

    // Keep casing for PostgreSQL lower(), matching the name index's collation. An empty array disables the name branch.
    internal static string[] NameWords(string query) => query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Where(word => word.Length >= 3).ToArray();

    internal static string Prefix(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";
}

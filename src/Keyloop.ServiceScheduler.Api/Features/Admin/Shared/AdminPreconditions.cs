using System.Globalization;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Shared;

/// <summary>Exactly one strong entity tag is required; wildcards cannot protect an editor from lost updates.</summary>
public static class AdminPreconditions
{
    public static string ResourceTag(uint version) => string.Create(CultureInfo.InvariantCulture, $"\"{version}\"");
    public static string PolicyTag(int version) => string.Create(CultureInfo.InvariantCulture, $"\"policy-{version}\"");

    public static void Check(string? ifMatch, string currentTag, object current)
    {
        if (string.IsNullOrWhiteSpace(ifMatch))
        {
            throw new AdminPreconditionException(428, null, null);
        }
        if (!string.Equals(ifMatch.Trim(), currentTag, StringComparison.Ordinal))
        {
            throw new AdminPreconditionException(412, currentTag, current);
        }
    }
}

public sealed class AdminPreconditionException(int status, string? currentETag, object? current) : Exception(
    status == 428 ? "Send the ETag from the resource read in If-Match." : "The resource changed. Reload it before reapplying the edit.")
{
    public int Status { get; } = status;
    public string? CurrentETag { get; } = currentETag;
    public object? Current { get; } = current;
}

public sealed class AdminFieldException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

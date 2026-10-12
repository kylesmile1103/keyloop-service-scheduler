namespace Keyloop.ServiceScheduler.Domain.Common;

internal static class Guard
{
    public static string Required(string? value, int min, int max, string paramName)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length < min || trimmed.Length > max)
        {
            throw new ArgumentException($"{paramName} must be between {min} and {max} characters.", paramName);
        }

        return trimmed;
    }

    /// <summary>Rejects <see cref="DateTimeKind.Local"/> and <see cref="DateTimeKind.Unspecified"/> instants (ARCHITECTURE §6.4: UTC everywhere).</summary>
    public static DateTime Utc(DateTime value, string paramName) =>
        value.Kind == DateTimeKind.Utc
            ? value
            : throw new ArgumentException($"{paramName} must be a UTC DateTime (Kind was {value.Kind}).", paramName);

    public static Guid NotEmpty(Guid value, string paramName) =>
        value != Guid.Empty ? value : throw new ArgumentException($"{paramName} must not be empty.", paramName);

    /// <summary>Copies <paramref name="values"/> into a new set, rejecting values that are not defined members of <typeparamref name="TEnum"/>.</summary>
    public static HashSet<TEnum> DefinedSet<TEnum>(IEnumerable<TEnum>? values, string paramName)
        where TEnum : struct, Enum
    {
        ArgumentNullException.ThrowIfNull(values, paramName);
        var set = values.ToHashSet();
        foreach (var value in set)
        {
            if (!Enum.IsDefined(value))
            {
                throw new ArgumentOutOfRangeException(paramName, value, $"Unknown {typeof(TEnum).Name} value.");
            }
        }

        return set;
    }
}

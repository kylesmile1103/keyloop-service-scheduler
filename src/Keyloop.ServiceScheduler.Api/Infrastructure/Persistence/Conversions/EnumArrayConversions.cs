using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Conversions;

/// <summary>
/// Persists the domain's enum sets (<see cref="IReadOnlySet{T}"/> backed by <see cref="HashSet{T}"/>) as sorted <c>text[]</c>
/// columns of member names. The conversion and comparison logic lives in public static methods that the converter and comparer
/// expressions call, which keeps the model compatible with <c>dotnet ef dbcontext optimize</c> (Addendum A §A7).
/// </summary>
public static class EnumArrayConversions
{
    /// <summary>Member names in ordinal order, so equal sets always produce identical arrays.</summary>
    public static string[] ToStorage<TEnum>(IReadOnlySet<TEnum> values)
        where TEnum : struct, Enum
    {
        ArgumentNullException.ThrowIfNull(values);
        var names = new string[values.Count];
        var i = 0;
        foreach (var value in values)
        {
            names[i++] = value.ToString();
        }

        Array.Sort(names, StringComparer.Ordinal);
        return names;
    }

    /// <summary>Parses member names; an unknown name is data corruption and throws.</summary>
    public static HashSet<TEnum> FromStorage<TEnum>(string[] values)
        where TEnum : struct, Enum
    {
        ArgumentNullException.ThrowIfNull(values);
        var set = new HashSet<TEnum>(values.Length);
        foreach (var name in values)
        {
            set.Add(Enum.Parse<TEnum>(name, ignoreCase: false));
        }

        return set;
    }

    public static bool SetEquals<TEnum>(IReadOnlySet<TEnum>? left, IReadOnlySet<TEnum>? right)
        where TEnum : struct, Enum =>
        ReferenceEquals(left, right) || (left is not null && right is not null && left.SetEquals(right));

    /// <summary>Order-independent hash, consistent with <see cref="SetEquals{TEnum}"/>.</summary>
    public static int SetHashCode<TEnum>(IReadOnlySet<TEnum> values)
        where TEnum : struct, Enum
    {
        ArgumentNullException.ThrowIfNull(values);
        var hash = 0;
        foreach (var value in values)
        {
            hash ^= value.GetHashCode();
        }

        return hash;
    }

    /// <summary>A copy for the change tracker's original-value snapshot.</summary>
    public static IReadOnlySet<TEnum> Snapshot<TEnum>(IReadOnlySet<TEnum> values)
        where TEnum : struct, Enum
    {
        ArgumentNullException.ThrowIfNull(values);
        return new HashSet<TEnum>(values);
    }

    public static ValueConverter<IReadOnlySet<TEnum>, string[]> Converter<TEnum>()
        where TEnum : struct, Enum =>
        new(v => ToStorage(v), v => FromStorage<TEnum>(v));

    public static ValueComparer<IReadOnlySet<TEnum>> Comparer<TEnum>()
        where TEnum : struct, Enum =>
        new((a, b) => SetEquals(a, b), v => SetHashCode(v), v => Snapshot(v));
}

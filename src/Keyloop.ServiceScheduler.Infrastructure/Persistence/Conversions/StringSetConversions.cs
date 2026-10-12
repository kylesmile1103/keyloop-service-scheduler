using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;

internal static class StringSetConversions
{
    public static string[] ToStorage(IReadOnlySet<string> values) => values.Order(StringComparer.Ordinal).ToArray();
    public static IReadOnlySet<string> FromStorage(string[] values) => values.ToHashSet(StringComparer.Ordinal);
    public static bool Equal(IReadOnlySet<string>? a, IReadOnlySet<string>? b) => ReferenceEquals(a, b) || (a is not null && b is not null && a.SetEquals(b));
    public static int Hash(IReadOnlySet<string> values) => values.Aggregate(0, (hash, value) => hash ^ StringComparer.Ordinal.GetHashCode(value));
    public static ValueConverter<IReadOnlySet<string>, string[]> Converter() => new(v => ToStorage(v), v => FromStorage(v));
    public static ValueComparer<IReadOnlySet<string>> Comparer() => new((a, b) => Equal(a, b), v => Hash(v), v => FromStorage(ToStorage(v)));
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>
/// Case-insensitive parser for single defined enum member names, rejecting integer literals and comma-separated flag lists.
/// </summary>
public static class ExactEnumName
{
    public static bool TryParse<TEnum>(string? text, out TEnum value) where TEnum : struct, Enum
    {
        foreach (var name in Enum.GetNames<TEnum>())
        {
            if (string.Equals(name, text, StringComparison.OrdinalIgnoreCase))
            {
                value = Enum.Parse<TEnum>(name);
                return true;
            }
        }

        value = default;
        return false;
    }

    /// <summary>Returns the enum's member names in declaration order.</summary>
    public static string Describe<TEnum>() where TEnum : struct, Enum => string.Join(", ", Enum.GetNames<TEnum>());
}

/// <summary>JSON converter that reads and writes a single defined <typeparamref name="TEnum"/> member name as a string.</summary>
public sealed class ExactEnumNameConverter<TEnum> : JsonConverter<TEnum> where TEnum : struct, Enum
{
    public override TEnum Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String && ExactEnumName.TryParse<TEnum>(reader.GetString(), out var value)
            ? value
            : throw new JsonException($"Expected exactly one of {ExactEnumName.Describe<TEnum>()} as a JSON string.");

    public override void Write(Utf8JsonWriter writer, TEnum value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteStringValue(Enum.IsDefined(value) ? value.ToString() : throw new JsonException("Only a defined member can be written."));
    }
}

/// <summary>JSON converter that reads and writes an array of defined <typeparamref name="TEnum"/> member names as strings.</summary>
public sealed class ExactEnumNameArrayConverter<TEnum> : JsonConverter<TEnum[]> where TEnum : struct, Enum
{
    public override TEnum[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartArray) { throw new JsonException("Expected an array of enum names."); }
        var values = new List<TEnum>();
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray) { return values.ToArray(); }
            if (reader.TokenType != JsonTokenType.String || !ExactEnumName.TryParse<TEnum>(reader.GetString(), out var value))
            {
                throw new JsonException("Expected one defined enum name as a JSON string.");
            }
            values.Add(value);
        }
        throw new JsonException("Expected the end of the enum array.");
    }

    public override void Write(Utf8JsonWriter writer, TEnum[] value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(value);
        writer.WriteStartArray();
        foreach (var item in value)
        {
            if (!Enum.IsDefined(item)) { throw new JsonException("Only a defined member can be written."); }
            writer.WriteStringValue(item.ToString());
        }
        writer.WriteEndArray();
    }
}

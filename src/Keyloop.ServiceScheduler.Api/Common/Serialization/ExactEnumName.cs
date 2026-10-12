using System.Text.Json;
using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>
/// One enum member name, and nothing else, for the vehicle-aware inputs (ADR-029). <c>Enum.TryParse</c> and System.Text.Json's
/// string enum converter also accept integers and comma-separated lists, whose members they OR together: <c>Heavy, LightCommercial</c>
/// is <c>VehicleClass.Unknown</c> (2 | 1 = 3), a defined value that silently drops the heavy-vehicle rule the client asked for, and
/// <c>4</c> is <c>Powertrain.BatteryElectric</c> although the contract is a string enum. Names match ignoring case, as before.
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

    /// <summary>The member names in declaration order, for messages and the OpenAPI document.</summary>
    public static string Describe<TEnum>() where TEnum : struct, Enum => string.Join(", ", Enum.GetNames<TEnum>());
}

/// <summary>
/// Reads one <typeparamref name="TEnum"/> member name from a JSON string (no number, no list) and writes the member name, exactly as
/// the context's string enum converter writes it. Applied with <c>[JsonConverter]</c> to request properties, so it holds whichever
/// options read the request; a value it rejects is unreadable JSON, a 400 <c>validation-error</c>. The OpenAPI document cannot see
/// through a custom converter, so <c>SchedulerOpenApi.DescribeExactEnumNames</c> lists the member names as the property's enum.
/// </summary>
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

/// <summary>Request arrays follow the same closed string-enum format as individual enum inputs; numbers and comma lists are unreadable.</summary>
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

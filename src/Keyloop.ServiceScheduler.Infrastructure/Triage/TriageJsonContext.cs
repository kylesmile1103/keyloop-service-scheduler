using System.Text.Json.Serialization;
using System.Text.Json;
using System.Text.Encodings.Web;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower)]
[JsonSerializable(typeof(ClefRequest))]
[JsonSerializable(typeof(ServiceRubric))]
[JsonSerializable(typeof(ClefEnvelope))]
internal sealed partial class TriageJsonContext : JsonSerializerContext
{
    // This JSON is an HTTP body, never HTML. Preserve base64 '+' characters instead of expanding them to six-byte
    // escapes, which could push valid 8 MiB image inputs past Cloudflare's 13 MiB request limit.
    internal static TriageJsonContext Transport { get; } = new(new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    });
}

internal sealed record ClefEnvelope(ClefResult? Result, Dictionary<string, ClefAnswer>? Answers, ClefUsage? Usage, bool? Success);
// Supports both bare and wrapped Workers AI Clef response shapes.
internal sealed record ClefResult(Dictionary<string, ClefAnswer>? Answers, ClefUsage? Usage, string? State, ClefResult? Result);
public sealed record ClefAnswer(string? Type, string? Choice, double? Confidence, Dictionary<string, double>? Probabilities);
internal sealed record ClefUsage(int? InputTokens);
public sealed record ClefEvaluation(ClefAnswer Service, ClefAnswer PreferredDate, ClefAnswer UncoveredIssue, int? InputTokens);

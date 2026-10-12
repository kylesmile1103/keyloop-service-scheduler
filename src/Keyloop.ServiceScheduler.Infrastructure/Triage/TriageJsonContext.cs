using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower)]
[JsonSerializable(typeof(JevRequest))]
[JsonSerializable(typeof(ServiceRubric))]
[JsonSerializable(typeof(JevEnvelope))]
internal sealed partial class TriageJsonContext : JsonSerializerContext;

internal sealed record JevEnvelope(JevResult? Result, Dictionary<string, JevAnswer>? Answers, JevUsage? Usage, bool? Success);
internal sealed record JevResult(Dictionary<string, JevAnswer>? Answers, JevUsage? Usage);
public sealed record JevAnswer(string? Type, string? Choice, double? Confidence, Dictionary<string, double>? Probabilities);
internal sealed record JevUsage(int? InputTokens);
public sealed record JevEvaluation(JevAnswer Service, JevAnswer PreferredDate, int? InputTokens);

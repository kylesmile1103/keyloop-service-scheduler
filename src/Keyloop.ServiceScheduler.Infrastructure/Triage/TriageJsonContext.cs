using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower)]
[JsonSerializable(typeof(JevRequest))]
[JsonSerializable(typeof(ServiceRubric))]
[JsonSerializable(typeof(JevEnvelope))]
internal sealed partial class TriageJsonContext : JsonSerializerContext;

internal sealed record JevEnvelope(JevResult? Result, Dictionary<string, JevAnswer>? Answers, JevUsage? Usage, bool? Success);
// /ai/run answers a third-party model with a completed run, { "result": { "state": "Completed", "result": { model body } } },
// observed on the first live call (2026-10-12); the single-wrapped and bare model bodies are accepted as well.
internal sealed record JevResult(Dictionary<string, JevAnswer>? Answers, JevUsage? Usage, string? State, JevResult? Result);
public sealed record JevAnswer(string? Type, string? Choice, double? Confidence, Dictionary<string, double>? Probabilities);
internal sealed record JevUsage(int? InputTokens);
public sealed record JevEvaluation(JevAnswer Service, JevAnswer PreferredDate, int? InputTokens);

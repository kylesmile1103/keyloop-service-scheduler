using System.Text.Json.Nodes;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

internal static class JevAnswerValidator
{
    internal static JevEvaluation Validate(JevEnvelope? envelope, JevRequest request)
    {
        if (envelope is null || envelope.Success == false)
        {
            throw new TriageUnavailableException("invalid-answer");
        }

        var run = envelope.Result;
        if (run?.State is { } state && state != "Completed")
        {
            throw new TriageUnavailableException("invalid-answer");
        }

        var body = run?.Result ?? run;
        var answers = body?.Answers ?? envelope.Answers;
        if (answers is null || answers.Count != 2 || !answers.TryGetValue("service", out var service) ||
            !answers.TryGetValue("preferred_date", out var date))
        {
            throw new TriageUnavailableException("invalid-answer");
        }

        ValidateChoice(service, request.Input.Questions["service"].Criteria);
        ValidateChoice(date, request.Input.Questions["preferred_date"].Criteria);
        var tokens = (body?.Usage ?? envelope.Usage)?.InputTokens;
        if (tokens < 0)
        {
            throw new TriageUnavailableException("invalid-answer");
        }

        return new(service, date, tokens);
    }

    private static void ValidateChoice(JevAnswer? answer, JsonObject options)
    {
        if (answer is not { Type: "choice", Choice: { } label, Confidence: { } confidence, Probabilities: { } probabilities } ||
            !options.ContainsKey(label) || !double.IsFinite(confidence) || confidence is < 0 or > 1 ||
            probabilities.Count != options.Count || options.Any(o => !probabilities.ContainsKey(o.Key)) ||
            probabilities.Any(p => !options.ContainsKey(p.Key) || !double.IsFinite(p.Value) || p.Value is < 0 or > 1) ||
            Math.Abs(probabilities.Values.Sum() - 1) > 0.02 || probabilities.Values.Any(p => p > probabilities[label] + 0.000001))
        {
            throw new TriageUnavailableException("invalid-answer");
        }
    }
}

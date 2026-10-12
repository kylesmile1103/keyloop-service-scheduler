using System.Text.Json;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class JevAnswerValidatorTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Reads_both_envelopes_without_runtime_reflection(bool envelope)
    {
        var (request, response) = Valid();
        var json = envelope ? "{\"result\":" + response + "}" : response;
        var parsed = JsonSerializer.Deserialize(json, TriageJsonContext.Default.JevEnvelope);
        var answer = JevAnswerValidator.Validate(parsed, request);
        answer.Service.Choice.ShouldBe("BRAKES-PADS-DISCS");
        answer.InputTokens.ShouldBe(123);
    }

    [Theory]
    [InlineData("unknown-service")]
    [InlineData("unknown-date")]
    [InlineData("unknown-probability")]
    [InlineData("missing-answer")]
    [InlineData("missing-probability")]
    [InlineData("missing-confidence")]
    [InlineData("invalid-confidence")]
    [InlineData("wrong-type")]
    [InlineData("negative-probability")]
    [InlineData("non-normalized")]
    [InlineData("wrong-winner")]
    [InlineData("null-answer")]
    public void Rejects_inconsistent_answers_without_retaining_payload(string fault)
    {
        var (request, json) = Valid();
        var response = System.Text.Json.Nodes.JsonNode.Parse(json)!;
        var service = response["answers"]!["service"]!;
        switch (fault)
        {
            case "unknown-service": service["choice"] = "PRIVATE UNKNOWN"; break;
            case "unknown-date": response["answers"]!["preferred_date"]!["choice"] = "1999-01-01"; break;
            case "unknown-probability": service["probabilities"]!["PRIVATE UNKNOWN"] = 0.0; break;
            case "missing-answer": response["answers"]!.AsObject().Remove("preferred_date"); break;
            case "missing-probability": service["probabilities"]!.AsObject().Remove("NONE_OF_THESE"); break;
            case "missing-confidence": service.AsObject().Remove("confidence"); break;
            case "invalid-confidence": service["confidence"] = 1.1; break;
            case "wrong-type": service["type"] = "score"; break;
            case "negative-probability": service["probabilities"]!["NONE_OF_THESE"] = -0.1; break;
            case "non-normalized": service["probabilities"]!["NONE_OF_THESE"] = 0.3; break;
            case "wrong-winner": service["choice"] = "NONE_OF_THESE"; break;
            case "null-answer": response["answers"]!["service"] = null; break;
        }
        var parsed = JsonSerializer.Deserialize(response.ToJsonString(), TriageJsonContext.Default.JevEnvelope);
        var exception = Should.Throw<TriageUnavailableException>(() => JevAnswerValidator.Validate(parsed, request));
        exception.Reason.ShouldBe("invalid-answer");
        exception.ToString().ShouldNotContain("PRIVATE UNKNOWN");
    }

    private static (JevRequest Request, string Response) Valid()
    {
        var request = JevQuestionBuilder.Build("typesafe/jev", "brakes squeal", [JevQuestionBuilderTests.Brakes], JevQuestionBuilderTests.Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 1);
        return (request, """
            {"answers":{"service":{"type":"choice","choice":"BRAKES-PADS-DISCS","confidence":0.8,"probabilities":{"BRAKES-PADS-DISCS":0.9,"NONE_OF_THESE":0.1}},
              "preferred_date":{"type":"choice","choice":"2026-10-13","confidence":0.9,"probabilities":{"2026-10-12":0,"2026-10-13":1,"NO_SPECIFIC_DATE":0}}},"usage":{"input_tokens":123}}
            """);
    }
}

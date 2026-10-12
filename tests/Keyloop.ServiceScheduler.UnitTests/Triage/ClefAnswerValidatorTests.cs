using System.Text.Json;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class ClefAnswerValidatorTests
{
    [Theory]
    [InlineData("bare")]
    [InlineData("result")]
    [InlineData("run")]
    public void Reads_every_envelope_without_runtime_reflection(string shape)
    {
        var (request, response) = Valid();
        var json = shape switch
        {
            "result" => "{\"result\":" + response + ",\"success\":true}",
            // The shape /ai/run returned on the first live call: a completed run wrapping the model's own body.
            "run" => "{\"result\":{\"state\":\"Completed\",\"result\":" + response + "},\"success\":true,\"errors\":[],\"messages\":[]}",
            _ => response,
        };
        var parsed = JsonSerializer.Deserialize(json, TriageJsonContext.Default.ClefEnvelope);
        var answer = ClefAnswerValidator.Validate(parsed, request);
        answer.Service.Choice.ShouldBe("BRAKES-PADS-DISCS");
        answer.InputTokens.ShouldBe(123);
    }

    [Theory]
    [InlineData("Queued")]
    [InlineData("Running")]
    [InlineData("Failed")]
    public void Rejects_a_run_that_has_not_completed(string state)
    {
        var (request, response) = Valid();
        var json = "{\"result\":{\"state\":\"" + state + "\",\"result\":" + response + "},\"success\":true}";
        var parsed = JsonSerializer.Deserialize(json, TriageJsonContext.Default.ClefEnvelope);
        Should.Throw<TriageUnavailableException>(() => ClefAnswerValidator.Validate(parsed, request)).Reason.ShouldBe("invalid-answer");
    }

    [Fact]
    public void Accepts_the_legacy_Jev_response_with_the_same_typed_answer_schema()
    {
        // The Reading catalogue and clock of the captured request (2026-10-12T08:00Z, 90-day horizon) and the body Cloudflare
        // returned for it through the keyloop-scheduler gateway on 2026-10-12, unedited.
        var request = ClefQuestionBuilder.Build("@cf/cloudflare/clef-flash", "Brakes squeal, it's an EV, need it Thursday.",
            ReferenceDataSeed.CreateServiceTypes().Where(s => s.Code != "ACCIDENT-DAMAGE-ASSESSMENT").ToArray(), ClefQuestionBuilderTests.Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 90);
        var parsed = JsonSerializer.Deserialize(LiveResponse, TriageJsonContext.Default.ClefEnvelope);
        var answer = ClefAnswerValidator.Validate(parsed, request);
        answer.Service.Choice.ShouldBe("BRAKES-PADS-DISCS");
        answer.PreferredDate.Choice.ShouldBe("2026-10-15");
        answer.InputTokens.ShouldBe(1942);
    }

    private const string LiveResponse = """
        {"result":{"state":"Completed","result":{"model":"jev-1.13.0","answers":{"service":{"type":"choice","choice":"BRAKES-PADS-DISCS","probabilities":{"AIRCON-REGAS":0,"BRAKES-PADS-DISCS":1,"DIAG-FAULT-FINDING":0,"EV-BATTERY-CHECK":0,"EV-CHARGING-FAULT":0,"WHEEL-ALIGNMENT":0,"FULL-SERVICE":0,"HEAVY-VAN-SERVICE":0,"INTERIM-SERVICE":0,"MOT-TEST":0,"NONE_OF_THESE":0},"confidence":1},"preferred_date":{"type":"choice","choice":"2026-10-15","probabilities":{"2026-10-12":0,"2026-10-13":0,"2026-10-14":0,"2026-10-15":0.98,"2026-10-16":0,"2026-10-17":0,"2026-10-18":0,"2026-10-19":0,"2026-10-20":0,"2026-10-21":0,"2026-10-22":0,"2026-10-23":0,"2026-10-24":0,"2026-10-25":0,"NO_SPECIFIC_DATE":0.02},"confidence":0.98}},"usage":{"input_tokens":1942,"output_tokens":416}}},"success":true,"errors":[],"messages":[]}
        """;

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
        var parsed = JsonSerializer.Deserialize(response.ToJsonString(), TriageJsonContext.Default.ClefEnvelope);
        var exception = Should.Throw<TriageUnavailableException>(() => ClefAnswerValidator.Validate(parsed, request));
        exception.Reason.ShouldBe("invalid-answer");
        exception.ToString().ShouldNotContain("PRIVATE UNKNOWN");
    }

    private static (ClefRequest Request, string Response) Valid()
    {
        var request = ClefQuestionBuilder.Build("@cf/cloudflare/clef-flash", "brakes squeal", [ClefQuestionBuilderTests.Brakes], ClefQuestionBuilderTests.Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 1);
        return (request, """
            {"answers":{"service":{"type":"choice","choice":"BRAKES-PADS-DISCS","confidence":0.8,"probabilities":{"BRAKES-PADS-DISCS":0.9,"NONE_OF_THESE":0.1}},
              "preferred_date":{"type":"choice","choice":"2026-10-13","confidence":0.9,"probabilities":{"2026-10-12":0,"2026-10-13":1,"NO_SPECIFIC_DATE":0}}},"usage":{"input_tokens":123}}
            """);
    }
}

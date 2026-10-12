using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>All triage traffic terminates here. No fallback transport or network access.</summary>
internal sealed class StubTriageHandler : HttpMessageHandler
{
    internal int Calls { get; private set; }
    internal Uri? Uri { get; private set; }
    internal Dictionary<string, string> Headers { get; } = new(StringComparer.OrdinalIgnoreCase);
    internal JsonNode? Body { get; private set; }
    internal int Status { get; set; } = 200;
    internal string? RawBody { get; set; }
    internal string ServiceChoice { get; set; } = "BRAKES-PADS-DISCS";
    internal string DateChoice { get; set; } = "2026-10-15";
    internal double Confidence { get; set; } = 0.98;
    /// <summary>"run" (what /ai/run returned live: a completed run wrapping the model body), "result" or "bare".</summary>
    internal string Shape { get; set; } = "run";
    internal int? RetryAfter { get; set; }
    internal bool Hang { get; set; }
    internal bool ThrowWithDescription { get; set; }
    internal bool FailFirst { get; set; }
    internal string ContentType { get; set; } = "application/json";

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        Uri = request.RequestUri;
        foreach (var header in request.Headers)
        {
            Headers[header.Key] = string.Join(",", header.Value);
        }

        Body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!;
        if (Hang)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }

        if (ThrowWithDescription)
        {
            throw new HttpRequestException(Body["input"]!["state"]!["customer_description"]!.GetValue<string>());
        }

        var payload = new JsonObject
        {
            ["answers"] = new JsonObject
            {
                ["service"] = Answer("service", ServiceChoice, Confidence),
                ["preferred_date"] = Answer("preferred_date", DateChoice, 0.8),
            },
            ["usage"] = new JsonObject { ["input_tokens"] = 432 },
        };
        var status = FailFirst && Calls > 1 ? 200 : Status;
        var json = RawBody ?? (Shape switch
        {
            "run" => new JsonObject { ["result"] = new JsonObject { ["state"] = "Completed", ["result"] = payload }, ["success"] = true },
            "result" => new JsonObject { ["result"] = payload, ["success"] = true },
            _ => payload,
        }).ToJsonString();
        var response = new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        response.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(ContentType);
        if (RetryAfter is { } seconds)
        {
            response.Headers.RetryAfter = new(TimeSpan.FromSeconds(seconds));
        }

        return response;
    }

    private JsonObject Answer(string question, string winner, double confidence)
    {
        var probabilities = new JsonObject();
        var criteria = Body!["input"]!["questions"]![question]!["criteria"]!.AsObject();
        foreach (var option in criteria)
        {
            probabilities[option.Key] = option.Key == winner ? 0.85 : 0.15 / (criteria.Count - 1);
        }

        return new() { ["type"] = "choice", ["choice"] = winner, ["confidence"] = confidence, ["probabilities"] = probabilities };
    }
}

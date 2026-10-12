using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>The native Workers AI Clef body. Media bytes and customer text never enter telemetry.</summary>
public sealed record ClefRequest(string Model, ClefState State, Dictionary<string, ClefQuestion> Questions,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ClefImage[]? Images = null);
public sealed record ClefState(string CustomerDescription);
public sealed record ClefQuestion(string Type, JsonObject Instructions, JsonObject Criteria);
public sealed record ClefImage(string ContentType, string Base64);

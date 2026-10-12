using System.Text.Json.Nodes;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>The universal Cloudflare /ai/run envelope. Customer text exists only in State.</summary>
public sealed record JevRequest(string Model, JevInput Input);
public sealed record JevInput(JevState State, Dictionary<string, JevQuestion> Questions);
public sealed record JevState(string CustomerDescription);
public sealed record JevQuestion(string Type, JsonObject Instructions, JsonObject Criteria);

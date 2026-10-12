using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

internal sealed record AccessJwks(AccessJwk[] Keys);
internal sealed record AccessJwk(string Kty, string Kid, string N, string E, string? Alg, string? Use);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(AccessJwks))]
internal sealed partial class AccessJsonContext : JsonSerializerContext;

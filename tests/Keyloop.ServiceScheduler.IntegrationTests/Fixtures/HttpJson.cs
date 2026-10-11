using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Reflection-free JSON over HTTP for tests. This process runs with reflection-based JSON disabled, as the API does, so the
/// metadata-less <c>ReadFromJsonAsync&lt;T&gt;()</c> throws; pass the API's own metadata, <c>SchedulerJsonContext.Default.X</c>.
/// Reading responses through the API's context also proves the wire format round-trips into the documented types.
/// </summary>
public static class HttpJson
{
    /// <summary>Asserts an <c>application/json</c> body and deserialises it with <paramref name="typeInfo"/>.</summary>
    public static async Task<T> ReadJsonAsync<T>(this HttpContent content, JsonTypeInfo<T> typeInfo, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);
        content.Headers.ContentType?.MediaType.ShouldBe("application/json");
        return await content.ReadFromJsonAsync(typeInfo, ct) ?? throw new ShouldAssertException("The response body was JSON null.");
    }

    /// <summary>Posts <paramref name="body"/> as <c>application/json</c>, serialised with <paramref name="typeInfo"/>.</summary>
    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body, JsonTypeInfo<T> typeInfo, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(client);
        return client.PostAsJsonAsync(url, body, typeInfo, ct);
    }

    /// <summary>Asserts an RFC 9457 <c>application/problem+json</c> body and parses it; the caller disposes the document.</summary>
    public static async Task<JsonDocument> ReadProblemAsync(this HttpResponseMessage response, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(response);
        response.Content.Headers.ContentType?.MediaType.ShouldBe("application/problem+json");
        return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
    }
}

using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Source-generated JSON helpers for HTTP test requests and responses.</summary>
public static class HttpJson
{
    /// <summary>Asserts an <c>application/json</c> body and deserialises it with <paramref name="typeInfo"/>.</summary>
    public static async Task<T> ReadJsonAsync<T>(this HttpContent content, JsonTypeInfo<T> typeInfo, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(content);
        content.Headers.ContentType.ShouldNotBeNull("no Content-Type").MediaType.ShouldBe("application/json");
        return await content.ReadFromJsonAsync(typeInfo, ct) ?? throw new ShouldAssertException("The response body was JSON null.");
    }

    /// <summary>Posts <paramref name="body"/> as <c>application/json</c>, serialised with <paramref name="typeInfo"/>.</summary>
    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body, JsonTypeInfo<T> typeInfo, CancellationToken ct) =>
        client.PostJsonAsync(url, body, typeInfo, headers: null, ct);

    /// <summary>Posts <paramref name="body"/> as <c>application/json</c> with per-request <paramref name="headers"/>.</summary>
    public static async Task<HttpResponseMessage> PostJsonAsync<T>(
        this HttpClient client, string url, T body, JsonTypeInfo<T> typeInfo, IReadOnlyDictionary<string, string>? headers, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(client);
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body, typeInfo) };
        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
        {
            request.Headers.Add(name, value);
        }

        return await client.SendAsync(request, ct);
    }

    /// <summary>Asserts an RFC 9457 <c>application/problem+json</c> body and parses it; the caller disposes the document.</summary>
    public static async Task<JsonDocument> ReadProblemAsync(this HttpResponseMessage response, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(response);
        response.Content.Headers.ContentType.ShouldNotBeNull("no Content-Type").MediaType.ShouldBe("application/problem+json");
        return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
    }
}

using System.Net;
using System.Net.Http.Headers;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>In-memory stub for the private R2 triage media relay (<c>http://triage-media.internal</c>).</summary>
internal sealed class StubTriageMediaRelay : HttpMessageHandler
{
    private readonly Dictionary<string, (string ContentType, byte[] Bytes, string Expires)> _objects = new(StringComparer.Ordinal);
    private readonly List<(HttpMethod Method, Uri Uri, string? ContentType, string? Expires)> _requests = [];

    internal HttpStatusCode? Status { get; set; }

    internal IReadOnlyList<(HttpMethod Method, Uri Uri, string? ContentType, string? Expires)> Requests
    {
        get
        {
            lock (_objects)
            {
                return [.. _requests];
            }
        }
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var expires = request.Headers.TryGetValues("x-upload-expires", out var values) ? string.Join(",", values) : null;
        lock (_objects)
        {
            _requests.Add((request.Method, request.RequestUri!, request.Content?.Headers.ContentType?.MediaType, expires));
            if (Status is { } status)
            {
                return new HttpResponseMessage(status);
            }

            var key = request.RequestUri!.AbsolutePath;
            if (request.Method == HttpMethod.Put)
            {
                _objects[key] = (request.Content!.Headers.ContentType!.MediaType!, body, expires!);
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }

            if (!_objects.TryGetValue(key, out var stored))
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }

            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(stored.Bytes) };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(stored.ContentType);
            response.Headers.Add("x-upload-expires", stored.Expires);
            return response;
        }
    }
}

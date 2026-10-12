using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Private R2 access via Container outboundByHost, with a bounded transient local equivalent.</summary>
public sealed class TriageImageStore(HttpClient http, IOptions<TriageConnectionOptions> options,
    TransientTriageImages local, TimeProvider clock)
{
    public async Task PutAsync(Guid dealership, Guid id, StoredTriageImage image, CancellationToken ct)
    {
        EnsureEnabled();
        if (options.Value.ImageStoreUrl.Length == 0) { local.Put(dealership, id, image); return; }
        using var request = new HttpRequestMessage(HttpMethod.Put, Url(dealership, id));
        request.Content = new ByteArrayContent(image.Bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(image.ContentType);
        request.Headers.Add("x-upload-expires", image.ExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        using var response = await SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new TriageUnavailableException("image-storage");
        }
    }

    public async Task<StoredTriageImage?> GetAsync(Guid dealership, Guid id, CancellationToken ct)
    {
        EnsureEnabled();
        if (options.Value.ImageStoreUrl.Length == 0)
        {
            return local.Get(dealership, id);
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, Url(dealership, id));
        using var response = await SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        if (!response.IsSuccessStatusCode || !response.Headers.TryGetValues("x-upload-expires", out var values) ||
            !long.TryParse(values.SingleOrDefault(), CultureInfo.InvariantCulture, out var seconds) || seconds < 0 || seconds > 253402300799)
        {
            throw new TriageUnavailableException("image-storage");
        }

        var expires = DateTimeOffset.FromUnixTimeSeconds(seconds);
        if (expires <= clock.GetUtcNow())
        {
            return null;
        }

        try
        {
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            var type = response.Content.Headers.ContentType?.MediaType ?? "";
            TriageImageValidator.Validate(type, bytes);
            return new(type, bytes, expires);
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or TriageInputException)
        { throw new TriageUnavailableException("image-storage"); }
    }

    private void EnsureEnabled()
    {
        if (!options.Value.Enabled || !options.Value.ImagesEnabled)
        {
            throw new TriageUnavailableException("images-disabled");
        }
    }

    private string Url(Guid dealership, Guid id) => $"{options.Value.ImageStoreUrl}/triage/{dealership:N}/{id:N}";

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try { return await http.SendAsync(request, ct); }
        catch (Exception ex) when (ex is HttpRequestException or IOException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        { throw new TriageUnavailableException("image-storage"); }
    }
}

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>
/// Dealership-scoped triage image store backed by private R2 relay or bounded transient local storage.
/// </summary>
public sealed class TriageImageStore(HttpClient http, IOptions<TriageConnectionOptions> options,
    TransientTriageImages local, TimeProvider clock, ILogger<TriageImageStore> logger)
{
    // The latest instant DateTimeOffset.FromUnixTimeSeconds accepts (9999-12-31T23:59:59Z).
    private const long MaxUnixSeconds = 253402300799;

    public async Task PutAsync(Guid dealership, Guid id, StoredTriageImage image, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(image);
        EnsureEnabled();
        if (options.Value.ImageStoreUrl.Length == 0)
        {
            if (!local.TryPut(dealership, id, image))
            {
                throw Unavailable("image-capacity");
            }

            return;
        }

        using var request = new HttpRequestMessage(HttpMethod.Put, Url(dealership, id));
        request.Content = new ByteArrayContent(image.Bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(image.ContentType);
        request.Headers.Add("x-upload-expires", image.ExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        using var response = await SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw Unavailable("image-storage");
        }
    }

    /// <summary>
    /// Reads one evaluation's images, in order, under one storage deadline and the combined decoded-byte budget. A missing, expired
    /// or other-dealership id, or an excessive total, is an <c>imageIds</c> input error; a slow or failing store is image-storage.
    /// </summary>
    public async Task<IReadOnlyList<StoredTriageImage>> ReadForEvaluationAsync(Guid dealership, IReadOnlyList<Guid> ids, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(ids);
        using var deadline = new CancellationTokenSource(TriageImageLimits.ReadDeadline, clock);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, deadline.Token);
        var images = new List<StoredTriageImage>(ids.Count);
        var total = 0L;
        try
        {
            foreach (var id in ids)
            {
                var image = await GetAsync(dealership, id, linked.Token)
                    ?? throw new TriageInputException("imageIds", "An image is missing or expired. Upload the photos again.");
                total += image.Bytes.Length;
                if (total > TriageImageLimits.MaxTotalImageBytes)
                {
                    throw new TriageInputException("imageIds", "Photos must total at most 8 MiB.");
                }

                images.Add(image);
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw Unavailable("image-storage");
        }

        return images;
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

        // Exactly one plain decimal expiry. Anything else is a relay or bucket defect: fail closed rather than serve an object of
        // unknown age, and never let a duplicated header escape as an unhandled exception.
        if (!response.IsSuccessStatusCode || !response.Headers.TryGetValues("x-upload-expires", out var values) ||
            values.ToArray() is not [var value] || !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) ||
            seconds > MaxUnixSeconds)
        {
            throw Unavailable("image-storage");
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
        {
            throw Unavailable("image-storage");
        }
    }

    // Disabled images are a published configuration state (GET /booking-triage), like disabled text triage: refused, not logged.
    private void EnsureEnabled()
    {
        if (!options.Value.Enabled || !options.Value.ImagesEnabled)
        {
            throw new TriageUnavailableException("images-disabled");
        }
    }

    private TriageUnavailableException Unavailable(string reason)
    {
        logger.TriageUnavailable(reason);
        return new TriageUnavailableException(reason);
    }

    private string Url(Guid dealership, Guid id) => $"{options.Value.ImageStoreUrl}/triage/{dealership:N}/{id:N}";

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            return await http.SendAsync(request, ct);
        }
        // An OperationCanceledException while ct is not cancelled is HttpClient's own timeout.
        catch (Exception ex) when (ex is HttpRequestException or IOException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw Unavailable("image-storage");
        }
    }
}

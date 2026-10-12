namespace Keyloop.ServiceScheduler.Api.Common.Http;

/// <summary>
/// Explicit opt-in to public caching for a successful anonymous GET whose body is identical for every caller and contains no
/// personal data or secrets. SecurityHeadersMiddleware keeps all other API responses, including errors, no-store.
/// </summary>
/// <param name="MaxAgeSeconds">Freshness lifetime in seconds; stale responses must be revalidated.</param>
internal sealed record PublicReadCacheMetadata(int MaxAgeSeconds);

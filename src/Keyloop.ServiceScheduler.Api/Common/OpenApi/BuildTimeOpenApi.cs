using System.Reflection;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>
/// Detects the build-time OpenAPI run (Addendum B §B1): <c>Microsoft.Extensions.ApiDescription.Server</c> starts the app's entry
/// point under <c>GetDocument.Insider</c> to write <c>contracts/openapi/v1.json</c>. The composition root then uses
/// <see cref="PlaceholderConnectionString"/> (never opened) and skips database initialisation; nothing else may differ, so the
/// build-time and runtime documents are identical.
/// </summary>
internal static class BuildTimeOpenApi
{
    public const string PlaceholderConnectionString = "Host=build-time-openapi;Database=none";

    /// <summary>True while Microsoft.Extensions.ApiDescription.Server is generating the OpenAPI document during build.</summary>
    public static bool IsActive { get; } = string.Equals(Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal);
}

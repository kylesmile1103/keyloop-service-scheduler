using System.Reflection;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>
/// Detects the build-time OpenAPI run (Addendum B §B1): <c>Microsoft.Extensions.ApiDescription.Server</c> starts the app's entry
/// point under <c>GetDocument.Insider</c> with a no-op server and writes <c>contracts/openapi/v1.json</c> once the host has started.
/// The composition root then runs in <see cref="EnvironmentName"/>, uses <see cref="PlaceholderConnectionString"/> (never opened) and
/// skips database initialisation; nothing else differs, so the build-time document equals the one served at runtime
/// (<c>OpenApiContractTests</c> compares it with SystemTest's).
/// </summary>
internal static class BuildTimeOpenApi
{
    public const string PlaceholderConnectionString = "Host=build-time-openapi;Database=none";

    /// <summary>
    /// The environment of the build-time run, whatever the build machine's variables say: Development needs no secrets, database or
    /// ingress addresses (UAT and Production refuse to start until forwarded-header trust is configured, SYSTEM_DESIGN §11.2), and the
    /// document does not depend on the environment.
    /// </summary>
    public const string EnvironmentName = "Development";

    /// <summary>True while Microsoft.Extensions.ApiDescription.Server is generating the OpenAPI document during build.</summary>
    public static bool IsActive { get; } = string.Equals(Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal);
}

using System.Reflection;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>Detects build-time OpenAPI document generation under <c>GetDocument.Insider</c>.</summary>
internal static class BuildTimeOpenApi
{
    public const string PlaceholderConnectionString = "Host=build-time-openapi;Database=none";

    /// <summary>Fixed environment name used during build-time OpenAPI generation.</summary>
    public const string EnvironmentName = "Development";

    /// <summary>True while Microsoft.Extensions.ApiDescription.Server is generating the OpenAPI document during build.</summary>
    public static bool IsActive { get; } = string.Equals(Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal);
}

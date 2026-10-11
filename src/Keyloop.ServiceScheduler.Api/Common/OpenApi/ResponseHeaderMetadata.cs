using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Common.OpenApi;

/// <summary>
/// A response header an endpoint sends with one status code, documented in the OpenAPI operation by <c>SchedulerOpenApi</c>
/// (Microsoft.AspNetCore.OpenApi infers no response headers). Add it with <see cref="ResponseHeaderExtensions.WithResponseHeader"/>.
/// </summary>
/// <param name="StatusCode">The response the header belongs to.</param>
/// <param name="Name">The header name, e.g. <c>Location</c>.</param>
/// <param name="Description">What it carries and when it is present.</param>
/// <param name="Format">The schema's <c>format</c>, e.g. <c>uri-reference</c>; null for none.</param>
/// <param name="Type">The schema's <c>type</c>: <see cref="JsonSchemaType.String"/> unless the value is a number, e.g. <c>Retry-After</c> seconds.</param>
public sealed record ResponseHeaderMetadata(int StatusCode, string Name, string Description, string? Format = null, JsonSchemaType Type = JsonSchemaType.String);

public static class ResponseHeaderExtensions
{
    /// <summary>Documents a response header for <paramref name="statusCode"/> (a string unless <paramref name="type"/> says otherwise).</summary>
    public static RouteHandlerBuilder WithResponseHeader(
        this RouteHandlerBuilder builder, int statusCode, string name, string description, string? format = null, JsonSchemaType type = JsonSchemaType.String) =>
        builder.WithMetadata(new ResponseHeaderMetadata(statusCode, name, description, format, type));
}

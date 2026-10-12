using Microsoft.AspNetCore.WebUtilities;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

public static class AuthUrls
{
    public const string Logout = "/cdn-cgi/access/logout";
    public static string Login(string? returnTo = null) => QueryHelpers.AddQueryString("/auth/login", "returnTo", SafeReturnTo(returnTo));
    public static string SafeReturnTo(string? value) => !string.IsNullOrEmpty(value) && value[0] == '/'
        && !value.StartsWith("//", StringComparison.Ordinal) && !value.Contains('\\') && !value.Any(char.IsControl) ? value : "/";

    public static void MapLogin(WebApplication app) => app.MapGet("/auth/login", (HttpContext http) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            return Results.LocalRedirect(SafeReturnTo(http.Request.Query["returnTo"].ToString()));
        })
        .RequireAuthorization().ExcludeFromDescription();
}

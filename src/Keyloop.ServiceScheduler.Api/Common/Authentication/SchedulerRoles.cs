using System.Security.Claims;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

public static class SchedulerRoles
{
    public const string Admin = "Admin";
    public const string ServiceAdvisor = "ServiceAdvisor";
    public const string Viewer = "Viewer";
    public static IReadOnlyList<string> All { get; } = [Admin, ServiceAdvisor, Viewer];
    public static bool CanReadPersonalData(ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true && All.Any(user.IsInRole);
    public static string? Email(ClaimsPrincipal user) => user.Identity?.IsAuthenticated == true ? user.FindFirstValue(ClaimTypes.Email) : null;
}

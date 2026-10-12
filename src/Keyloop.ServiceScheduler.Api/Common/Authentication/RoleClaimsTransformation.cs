using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>Only verified email membership grants API roles. Access JWT roles and custom groups are never trusted as API roles.</summary>
public sealed class RoleClaimsTransformation(IOptions<AuthOptions> options) : IClaimsTransformation
{
    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var email = SchedulerRoles.Email(principal);
        if (email is null)
        {
            return Task.FromResult(principal);
        }

        var domain = email[(email.LastIndexOf('@') + 1)..];
        var identity = new ClaimsIdentity();
        foreach (var (role, members) in options.Value.Memberships())
        {
            if (!principal.IsInRole(role) && members.Any(member => member.StartsWith('@')
                    ? string.Equals(member[1..], domain, StringComparison.OrdinalIgnoreCase)
                    : string.Equals(member, email, StringComparison.OrdinalIgnoreCase)))
            {
                identity.AddClaim(new Claim(ClaimTypes.Role, role));
            }
        }
        if (!identity.Claims.Any())
        {
            return Task.FromResult(principal);
        }

        var result = principal.Clone();
        result.AddIdentity(identity);
        return Task.FromResult(result);
    }
}

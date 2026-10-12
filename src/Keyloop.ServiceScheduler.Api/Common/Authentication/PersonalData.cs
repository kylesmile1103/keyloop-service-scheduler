using System.Security.Claims;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>The shared audience policy for the public schedule and appointment-range read.</summary>
internal static class PersonalData
{
    internal static (string CustomerName, string Vin) ForCaller(ClaimsPrincipal caller, string customerName, string vin)
    {
        ArgumentNullException.ThrowIfNull(caller);
        if (SchedulerRoles.CanReadPersonalData(caller))
        {
            return (customerName, vin);
        }
        var initials = string.Concat(customerName.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(part => char.ToUpperInvariant(part[0])));
        return (initials, vin[^6..]);
    }
}

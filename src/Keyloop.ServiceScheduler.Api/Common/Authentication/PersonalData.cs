using System.Security.Claims;
using System.Text;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>
/// Resolves customer personal data for schedule and appointment list responses, returning full values for callers with an API role and masked values otherwise.
/// </summary>
internal static class PersonalData
{
    internal const string MaskedRegistration = VehicleDetails.MaskedRegistration;

    /// <summary>The values a caller receives.</summary>
    internal readonly record struct Values(string CustomerName, string Vin, string Registration);

    internal static Values ForCaller(ClaimsPrincipal caller, string customerName, Vin vin, string registration)
    {
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(vin);
        return SchedulerRoles.CanReadPersonalData(caller)
            ? new Values(customerName, vin.Value, registration)
            : new Values(Initials(customerName), vin.Masked, MaskedRegistration);
    }

    /// <summary>One upper-case initial per whitespace-separated part: its first letter, as a whole Unicode scalar value.</summary>
    internal static string Initials(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var initials = new StringBuilder();
        foreach (var part in name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var rune in part.EnumerateRunes())
            {
                if (Rune.IsLetter(rune))
                {
                    initials.Append(Rune.ToUpperInvariant(rune).ToString());
                    break;
                }
            }
        }

        return initials.ToString();
    }
}

using System.Security.Claims;
using System.Text;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

/// <summary>
/// The single audience policy for personal data on the anonymous reads: the workshop schedule and the appointment-range read
/// (ARCHITECTURE section 8.7, ADR-027). A caller with any API role (Admin, ServiceAdvisor, Viewer) receives the stored values. Every
/// other caller (anonymous, an invalid or expired session, or a verified identity without a configured role) receives fixed masks:
/// <list type="bullet">
/// <item>customer name: one upper-case initial per whitespace-separated part, from the part's first letter (leading punctuation
/// and digits are skipped; a part without a letter contributes nothing): <c>Alice Louise Smith</c> and <c>(Alice) Smith</c>
/// become <c>ALS</c> and <c>AS</c>;</item>
/// <item>VIN: the domain mask that logs and events use, <see cref="Vin.Masked"/>: <c>WVWZZZ1KZAW123456</c> becomes
/// <c>***********123456</c>;</item>
/// <item>registration: fully masked as <c>*******</c>, whatever the plate. The last three letters of a current UK plate are its
/// most distinctive part, so no suffix is kept, and the fixed width does not reveal the plate's length.</item>
/// </list>
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

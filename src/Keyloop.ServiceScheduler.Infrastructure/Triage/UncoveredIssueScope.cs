using System.Collections.Frozen;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>
/// The uncovered-issue categories each service already addresses, so a notice never tells a person to book separately what the
/// service Clef chose will look at. One static, reviewed map derived from <see cref="ServiceTriageRubric"/> and the uncovered_issue
/// option text in <see cref="ClefQuestionBuilder"/>: change the three together. A code absent from the map (including
/// <see cref="ClefQuestionBuilder.NoneOfThese"/>, which is no service) suppresses nothing.
/// </summary>
/// <remarks>
/// <para>Entries.</para>
/// <list type="bullet">
/// <item>ACCIDENT-DAMAGE-ASSESSMENT covers ACCIDENT_OR_BODY_DAMAGE: the service is the collision and body damage inspection itself
/// (rubric "crash damage", "dented panel or bumper after impact"); live fixture 43 named it at 0.84 beside this very service.</item>
/// <item>ACCIDENT-DAMAGE-ASSESSMENT covers LIGHTS_OR_ELECTRICAL_ACCESSORY: rubric "broken headlights after a collision"; option text
/// "impact-damaged lights are covered by accident assessment". Fixture 26, the stakeholder's own crash and headlight sentence,
/// expects no notice.</item>
/// <item>ACCIDENT-DAMAGE-ASSESSMENT covers GLASS and TYRES_OR_WHEELS: rubric "impact damage to glass, wheels or suspension"; option
/// text "accident assessment covers inspection of impact-damaged glass" and "covers impact inspection". Fixture 28 (glass and
/// suspension after a collision) expects no notice.</item>
/// <item>AIRCON-REGAS covers AIR_CONDITIONING: the service is the air-conditioning recharge and performance check, so the fixed phrase
/// "air conditioning" beside it names the service's own subject. An AC that will not switch on is outside the regas (rubric not-for),
/// but the rubric routes it to diagnosis: that misroute is a service-choice error, not something this notice can explain.</item>
/// </list>
/// <para>
/// Why the impact-only qualifier does not split the accident entries: the categories cannot say whether a light, pane or wheel was
/// damaged in the impact, but choosing the assessment means Clef read the description as collision damage. On the live run, whenever
/// the description was a collision (fixtures 26, 32, 37, 43, 46), Clef's category beside this service named the damage the service
/// inspects, never the separate issue. Replacing glass or tyres and repairing lights stays outside the assessment, which its own copy
/// ("not the repair itself") already tells the person. The cost: a crash plus an unrelated, non-impact light, glass or tyre problem
/// loses its notice, and so does a non-impact repair misrouted to the assessment instead of no-match (fixture 48, a windscreen
/// replacement, confirm at 0.485 with GLASS at 0.62; fixture 49, a blown bulb, LIGHTS below the threshold).
/// </para>
/// <para>Omissions.</para>
/// <list type="bullet">
/// <item>OTHER is never covered: it means a problem outside the chosen service that fits no other category.</item>
/// <item>ACCIDENT-DAMAGE-ASSESSMENT omits AIR_CONDITIONING: rubric not-for "unrelated air conditioning fault"; the stakeholder's case
/// (fixture 46) accepts the assessment with an AIR_CONDITIONING notice.</item>
/// <item>WHEEL-ALIGNMENT omits TYRES_OR_WHEELS: the rubric covers geometry (pull, uneven wear, off-centre wheel) and lists "tyre
/// puncture repair" as not-for; the option text says alignment covers geometry and does not replace tyres. A geometry symptom on its
/// own is a single covered issue, which the question already answers NONE.</item>
/// <item>DIAG-FAULT-FINDING omits ACCIDENT_OR_BODY_DAMAGE and LIGHTS_OR_ELECTRICAL_ACCESSORY (rubric not-for "collision damage
/// assessment", "bodywork or headlight repair"; fixtures 37 and 46 expect the crash outside it) and AIR_CONDITIONING: only an AC that
/// will not switch on is diagnosis, weak cooling is a regas, and choosing diagnosis does not say which an AC mention is. A regas
/// beside a diagnosed fault is a real second booking; a lone switch-on failure is answered NONE (fixtures 34 and 35 were).</item>
/// <item>MOT-TEST omits every category: the test checks roadworthiness and repairs nothing; fixture 40 expects TYRES_OR_WHEELS.</item>
/// <item>INTERIM-SERVICE, FULL-SERVICE and HEAVY-VAN-SERVICE omit every category: routine maintenance, rubric not-for a specific
/// repair or fault diagnosis; fixture 39 expects LIGHTS_OR_ELECTRICAL_ACCESSORY beside the interim service.</item>
/// <item>BRAKES-PADS-DISCS omits every category: brakes have no category of their own; fixtures 38, 43 and 47 expect AC or crash
/// notices beside it.</item>
/// <item>EV-BATTERY-CHECK and EV-CHARGING-FAULT omit every category: traction battery and charging only, rubric not-for "12 volt
/// battery fault" and "phone charger problem", so a 12 volt or accessory problem stays a notice.</item>
/// </list>
/// </remarks>
public static class UncoveredIssueScope
{
    internal static readonly FrozenDictionary<string, FrozenSet<string>> Covered = new Dictionary<string, FrozenSet<string>>(StringComparer.Ordinal)
    {
        ["ACCIDENT-DAMAGE-ASSESSMENT"] = new[] { "ACCIDENT_OR_BODY_DAMAGE", "LIGHTS_OR_ELECTRICAL_ACCESSORY", "GLASS", "TYRES_OR_WHEELS" }
            .ToFrozenSet(StringComparer.Ordinal),
        ["AIRCON-REGAS"] = new[] { "AIR_CONDITIONING" }.ToFrozenSet(StringComparer.Ordinal),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>Whether <paramref name="category"/> lies inside the scope of the service Clef chose (<paramref name="serviceCode"/>).</summary>
    public static bool Covers(string serviceCode, string category) =>
        Covered.TryGetValue(serviceCode, out var covered) && covered.Contains(category);
}

using System.Collections.Frozen;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>
/// The uncovered-issue categories each service already addresses, so a notice never tells a person to book separately what the
/// service Clef chose will look at. One static map, reviewed together with <see cref="ServiceTriageRubric"/> and the uncovered_issue
/// option text in <see cref="ClefQuestionBuilder"/>: change them together. It enforces only what a category alone shows to be inside
/// the service, so the option text can ask Clef for more judgement than the map enforces. A code absent from the map (including
/// <see cref="ClefQuestionBuilder.NoneOfThese"/>, which is no service) suppresses nothing.
/// </summary>
/// <remarks>
/// <para>Entries.</para>
/// <list type="bullet">
/// <item>ACCIDENT-DAMAGE-ASSESSMENT covers ACCIDENT_OR_BODY_DAMAGE: the service is the collision and body damage inspection itself
/// (rubric "crash damage", "dented panel or bumper after impact"); on the 2026-10-13 live run fixture 43 named it at 0.84 beside
/// this very service, a notice contradicting the suggestion.</item>
/// <item>AIRCON-REGAS covers AIR_CONDITIONING: the service is the air-conditioning recharge and performance check, so the fixed phrase
/// "air conditioning" beside it names the service's own subject. An AC that will not switch on is outside the regas (rubric not-for),
/// but the rubric routes it to diagnosis: that misroute is a service-choice error, not something this notice can explain.</item>
/// </list>
/// <para>
/// Why the assessment does not cover LIGHTS_OR_ELECTRICAL_ACCESSORY, GLASS or TYRES_OR_WHEELS, although its rubric and the option
/// text cover inspecting impact-damaged lights, glass, wheels and suspension: the categories cannot say whether the damage came from
/// an impact, and choosing the assessment does not mean Clef read a collision. On the 2026-10-13 run all seven service misses chose
/// the assessment, five of them for repairs with no collision (fixtures 30, 31, 32, 48 and 49: windscreen, puncture, repaint,
/// windscreen, bulb), and covering these three categories changed exactly one notice: fixture 48's GLASS (0.62) beside a windscreen
/// replacement, a correct notice, since the assessment is "not the repair itself". Where the text named a crash or collision
/// (fixtures 26, 27, 28, 36, 37, 43, 45, 46), Clef named lights, glass or tyres once, GLASS at 0.134 on fixture 26, far below the
/// threshold. The remaining risk: a crash with an impact-damaged headlight, pane or wheel can show a notice beside the assessment
/// (for example "Also mentioned: lights or electrical accessories") when Clef names that category confidently. The remedy is for a
/// future approved run: a rubric line such as "only after a collision or impact", measured live before any of these categories
/// joins the map.
/// </para>
/// <para>Omissions.</para>
/// <list type="bullet">
/// <item>OTHER is never covered: it means a problem outside the chosen service that fits no other category.</item>
/// <item>ACCIDENT-DAMAGE-ASSESSMENT omits AIR_CONDITIONING: rubric not-for "unrelated air conditioning fault"; the stakeholder's case
/// (fixture 46) accepts the assessment with an AIR_CONDITIONING notice. It also omits LIGHTS_OR_ELECTRICAL_ACCESSORY, GLASS and
/// TYRES_OR_WHEELS, for the reasons above.</item>
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
        ["ACCIDENT-DAMAGE-ASSESSMENT"] = new[] { "ACCIDENT_OR_BODY_DAMAGE" }.ToFrozenSet(StringComparer.Ordinal),
        ["AIRCON-REGAS"] = new[] { "AIR_CONDITIONING" }.ToFrozenSet(StringComparer.Ordinal),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>Whether <paramref name="category"/> lies inside the scope of the service Clef chose (<paramref name="serviceCode"/>).</summary>
    public static bool Covers(string serviceCode, string category) =>
        Covered.TryGetValue(serviceCode, out var covered) && covered.Contains(category);
}

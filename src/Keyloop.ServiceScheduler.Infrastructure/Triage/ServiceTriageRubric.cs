using System.Collections.Frozen;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

internal sealed record ServiceRubric(string Name, string What, string[] TypicalSymptoms, string[] NotFor);

/// <summary>Rubric data keyed to the seeded catalogue, without changing the persistent model.</summary>
internal static class ServiceTriageRubric
{
    internal static readonly FrozenDictionary<string, ServiceRubric> Entries = new Dictionary<string, ServiceRubric>(StringComparer.Ordinal)
    {
        ["INTERIM-SERVICE"] = new("Interim Service", "Routine shorter maintenance, oil and filter change",
            ["oil change due", "six month service", "routine interim maintenance"], ["annual full service", "specific repair", "heavy van maintenance"]),
        ["FULL-SERVICE"] = new("Full Service", "Comprehensive scheduled annual maintenance and inspection",
            ["annual service due", "full service", "comprehensive maintenance"], ["oil change only", "specific fault diagnosis", "heavy van maintenance"]),
        ["MOT-TEST"] = new("MOT Test", "Statutory UK roadworthiness test",
            ["MOT due", "MOT renewal", "roadworthiness test"], ["routine maintenance", "brake repair", "German inspection not offered here"]),
        ["BRAKES-PADS-DISCS"] = new("Brake Pads & Discs", "Brake inspection and pad or disc repair for any powertrain",
            ["brakes squeal", "grinding when braking", "worn brake pads", "brake vibration"], ["EV charging fault", "traction battery health", "steering pull without braking"]),
        ["EV-BATTERY-CHECK"] = new("EV Battery Health Check", "High voltage traction battery health and capacity assessment",
            ["reduced electric range", "battery health check", "traction battery degradation"], ["charging fails", "brake noise", "12 volt battery fault"]),
        ["EV-CHARGING-FAULT"] = new("EV Charging Fault Diagnosis", "Diagnosis of electric vehicle charging faults",
            ["EV will not charge", "charging stops", "charge port fault"], ["battery health assessment", "brake noise", "phone charger problem"]),
        ["WHEEL-ALIGNMENT"] = new("Four-Wheel Alignment", "Wheel geometry and tracking adjustment",
            ["car pulls to one side", "uneven tyre wear", "steering wheel off centre"], ["brake squeal", "engine warning light", "tyre puncture repair"]),
        ["HEAVY-VAN-SERVICE"] = new("Heavy Van Service", "Scheduled maintenance for a heavy commercial van",
            ["heavy van service due", "commercial van maintenance"], ["passenger car routine service", "specific EV charging fault"]),
        ["AIRCON-REGAS"] = new("Air-Con Regas", "Air conditioning refrigerant recharge and performance check",
            ["air conditioning not cold", "weak cabin cooling", "aircon regas"], ["engine overheating", "heater not warm", "EV charging fault"]),
        ["DIAG-FAULT-FINDING"] = new("Diagnostic Fault Finding", "General vehicle fault and warning light diagnosis",
            ["engine warning light", "rough running", "unexplained fault code", "vehicle will not start"], ["known brake pad wear", "EV charging fault", "routine scheduled service"]),
    }.ToFrozenDictionary(StringComparer.Ordinal);
}

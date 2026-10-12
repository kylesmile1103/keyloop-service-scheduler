using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public enum RequirementCondition { ServicePowertrain, VehicleClass, LiveDiagnosis }

/// <summary>Closed, typed policy vocabulary persisted as reference data. Effects only add constraints; no expressions or runtime discovery.</summary>
public sealed record RequirementRule
{
    public Guid Id { get; init; }
    public Guid DealershipId { get; init; }
    public int PolicyVersion { get; init; }
    public int Order { get; init; }
    public string Code { get; init; } = string.Empty;
    public RequirementCondition Condition { get; init; }
    public Powertrain[] Powertrains { get; init; } = [];
    public string[] ServiceCodes { get; init; } = [];
    public VehicleClass? VehicleClass { get; init; }
    public int MinimumHvLevel { get; init; }
    public BayCapability[] BayCapabilities { get; init; } = [];
    public Certification[] Certifications { get; init; } = [];

    public static IReadOnlyList<string> HvServiceCodes { get; } =
        ["WHEEL-ALIGNMENT", "MOT-TEST", "INTERIM-SERVICE", "FULL-SERVICE", "BRAKES-PADS-DISCS", "DIAG-FAULT-FINDING",
            "HEAVY-VAN-SERVICE", "AIRCON-REGAS", "EV-BATTERY-CHECK", "EV-CHARGING-FAULT"];

    public static IReadOnlyList<RequirementRule> DefaultPolicy(Guid dealershipId)
    {
        Powertrain[] hv = [Powertrain.MildHybrid, Powertrain.FullHybrid, Powertrain.PluginHybrid, Powertrain.BatteryElectric, Powertrain.FuelCell, Powertrain.Unknown];
        return
        [
            Rule("hv-awareness", 10, 1, ["WHEEL-ALIGNMENT", "MOT-TEST"]),
            Rule("hv-routine", 20, 2, ["INTERIM-SERVICE", "FULL-SERVICE", "BRAKES-PADS-DISCS", "DIAG-FAULT-FINDING", "HEAVY-VAN-SERVICE"]),
            Rule("hv-aircon", 30, 3, ["AIRCON-REGAS"]),
            Rule("hv-components", 40, 3, ["EV-BATTERY-CHECK", "EV-CHARGING-FAULT"]) with { BayCapabilities = [BayCapability.EvHighVoltage] },
            Rule("heavy-vehicle", 50, 0, []) with { Condition = RequirementCondition.VehicleClass, Powertrains = [], VehicleClass = Scheduling.VehicleClass.Heavy,
                BayCapabilities = [BayCapability.HeavyDutyLift], Certifications = [Certification.HeavyVehicle] },
            Rule("hv-live-diagnosis", 60, 4, []) with { Condition = RequirementCondition.LiveDiagnosis, Powertrains = [], BayCapabilities = [BayCapability.EvHighVoltage] },
        ];

        RequirementRule Rule(string code, int order, int level, string[] services) => new()
        {
            Id = DeterministicGuid.Create($"requirement-rule:{dealershipId}:1:{code}"), DealershipId = dealershipId, PolicyVersion = 1,
            Code = code, Order = order, Condition = RequirementCondition.ServicePowertrain, Powertrains = hv, ServiceCodes = services, MinimumHvLevel = level,
        };
    }
}

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

/// <summary>One closed typed rule; order and code define deterministic evaluation. No expressions or brand rules.</summary>
/// <param name="Code" example="hv-routine">Unique stable slug, at most 64 characters.</param>
/// <param name="Order" example="20">Nonnegative ordering number; code breaks ties.</param>
/// <param name="Condition" example="ServicePowertrain">ServicePowertrain, VehicleClass or LiveDiagnosis.</param>
/// <param name="Powertrains">Nonempty only for ServicePowertrain. Unknown inherits every concrete HV rule.</param>
/// <param name="ServiceCodes">Existing global service codes, nonempty only for ServicePowertrain.</param>
/// <param name="VehicleClass">Non-null only for VehicleClass; send null explicitly for the other conditions.</param>
/// <param name="MinimumHvLevel" example="2">Monotone minimum 0..4.</param>
/// <param name="BayCapabilities">Additional equipment constraints.</param>
/// <param name="Certifications">Additional task qualifications.</param>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RequirementRuleInput(
    [property: Required, StringLength(64)] string Code,
    [property: JsonRequired, Range(0, int.MaxValue)] int Order,
    [property: JsonRequired, JsonConverter(typeof(ExactEnumNameConverter<RequirementCondition>))] RequirementCondition Condition,
    [property: Required, JsonConverter(typeof(ExactEnumNameArrayConverter<Powertrain>))] Powertrain[] Powertrains,
    [property: Required] string[] ServiceCodes,
    [property: JsonRequired, JsonConverter(typeof(ExactEnumNameConverter<VehicleClass>))] VehicleClass? VehicleClass,
    [property: JsonRequired, Range(0, 4)] int MinimumHvLevel,
    [property: Required, JsonConverter(typeof(ExactEnumNameArrayConverter<BayCapability>))] BayCapability[] BayCapabilities,
    [property: Required, JsonConverter(typeof(ExactEnumNameArrayConverter<Certification>))] Certification[] Certifications);

/// <summary>Replace a dealership's whole policy. DryRun previews without saving; a subsequent save rechecks If-Match.</summary>
/// <param name="Rules">At most 32 typed rules; empty intentionally removes every dealership rule.</param>
/// <param name="DryRun" example="true">True computes the consequence preview and writes nothing.</param>
/// <param name="PreviewDate" example="2026-10-13">Required local date for qualification expiry in the preview.</param>
public sealed record PolicyWriteRequest([property: Required] RequirementRuleInput[] Rules, [property: JsonRequired] bool DryRun, DateOnly PreviewDate);

/// <summary>Immutable policy state. ETag is quoted policy-{version}; old versions are retained.</summary>
public sealed record AdminPolicyResponse(Guid DealershipId, int Version, IReadOnlyList<RequirementRuleInput> Rules);

/// <summary>Changed roster bookability by service, powertrain, vehicle class and live-diagnosis mode, on the preview date. Busy time is excluded.</summary>
public sealed record PolicyBookabilityChange(Guid ServiceTypeId, string ServiceCode, Powertrain Powertrain, VehicleClass VehicleClass,
    bool NeedsLiveDiagnosis, bool WasBookable, bool IsBookable);

/// <summary>A preview or committed policy. An empty changes array means roster bookability did not change.</summary>
public sealed record PolicyEditResponse(bool Saved, AdminPolicyResponse Policy, DateOnly PreviewDate, IReadOnlyList<PolicyBookabilityChange> Changes);

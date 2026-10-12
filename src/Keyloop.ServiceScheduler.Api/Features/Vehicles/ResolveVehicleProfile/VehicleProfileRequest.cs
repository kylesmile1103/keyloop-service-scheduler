using FluentValidation;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;

/// <summary>Explicit acknowledgement of authoritative decoded data. A declaration can never override it.</summary>
public enum ProfileConflictChoice { UseDecoded }

/// <summary>Advisor-declared facts; source, actor and reason are assigned by the server. Omission means Unknown.</summary>
/// <param name="Powertrain">Powertrain observed at intake; a concrete value requires a reason.</param>
/// <param name="Manufacturer">Normalized OEM code, maximum 32 ASCII letters/digits/hyphens.</param>
/// <param name="VehicleClass">Car, light commercial, heavy, or Unknown.</param>
/// <param name="DeclarationReason">Private audit reason, 1..500 characters after trimming, required for concrete powertrain.</param>
/// <param name="ConflictChoice">UseDecoded acknowledges a discrepancy and retains decoded values and their provenance.</param>
public sealed record VehicleProfileRequest(Powertrain Powertrain = Powertrain.Unknown, string? Manufacturer = null,
    VehicleClass VehicleClass = VehicleClass.Unknown, string? DeclarationReason = null, ProfileConflictChoice? ConflictChoice = null);

public sealed class VehicleProfileRequestValidator : AbstractValidator<VehicleProfileRequest>
{
    public VehicleProfileRequestValidator()
    {
        RuleFor(p => p.Powertrain).IsInEnum();
        RuleFor(p => p.VehicleClass).IsInEnum();
        RuleFor(p => p.ConflictChoice).IsInEnum();
        RuleFor(p => p.Manufacturer).Must(m => m is null || (m.Trim().Length is >= 1 and <= 32
            && m.Trim().All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))).WithMessage("manufacturer must be a normalized OEM code of at most 32 characters.");
        RuleFor(p => p.DeclarationReason).Must((p, reason) =>
            p.Powertrain == Powertrain.Unknown ? reason is null || reason.Trim().Length is >= 1 and <= VehicleProfile.MaxDeclarationReasonLength
                : !string.IsNullOrWhiteSpace(reason) && reason.Trim().Length <= VehicleProfile.MaxDeclarationReasonLength)
            .WithMessage("A concrete powertrain requires a declaration reason of 1 to 500 characters.");
    }
}

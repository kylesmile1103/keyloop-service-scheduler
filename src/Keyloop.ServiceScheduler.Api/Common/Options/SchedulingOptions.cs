using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>Booking window, slot granularity, and scheduling feature configuration.</summary>
public sealed class SchedulingOptions : IValidatableObject
{
    public const string SectionName = "Scheduling";

    /// <summary>Whether vehicle-aware technician and bay requirements are enforced during availability and booking.</summary>
    [Required]
    public bool VehicleAwareRequirements { get; set; }

    /// <summary>Start times fall on this grid from opening time.</summary>
    [Range(5, 60)]
    public int SlotGranularityMinutes { get; set; } = 15;

    /// <summary>Minimum lead time from now before the earliest bookable slot start.</summary>
    public TimeSpan MinimumLeadTime { get; set; } = TimeSpan.Zero;

    /// <summary>Maximum number of days in the future for bookable slot starts.</summary>
    [Range(1, 365)]
    public int BookingHorizonDays { get; set; } = 90;

    /// <summary>Maximum number of alternative slots suggested on a 409 slot conflict.</summary>
    [Range(0, 10)]
    public int SuggestedSlotCount { get; set; } = 3;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (MinimumLeadTime < TimeSpan.Zero || MinimumLeadTime > TimeSpan.FromDays(7))
        {
            yield return new ValidationResult(
                $"{nameof(MinimumLeadTime)} must be between zero and seven days (inclusive).", [nameof(MinimumLeadTime)]);
        }

        if (TimeSpan.FromDays(BookingHorizonDays) <= MinimumLeadTime)
        {
            yield return new ValidationResult(
                $"{nameof(MinimumLeadTime)} must be shorter than {nameof(BookingHorizonDays)}.", [nameof(MinimumLeadTime), nameof(BookingHorizonDays)]);
        }
    }
}

[OptionsValidator]
public sealed partial class SchedulingOptionsValidator : IValidateOptions<SchedulingOptions>;

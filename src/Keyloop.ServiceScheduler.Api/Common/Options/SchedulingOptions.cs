using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>Booking rules that vary by environment (ARCHITECTURE §10). Validated at startup by <see cref="SchedulingOptionsValidator"/>.</summary>
public sealed class SchedulingOptions : IValidatableObject
{
    public const string SectionName = "Scheduling";

    /// <summary>Start times fall on this grid from opening time.</summary>
    [Range(5, 60)]
    public int SlotGranularityMinutes { get; set; } = 15;

    /// <summary>The earliest bookable start is now plus this (UAT/Production one hour; Development/SystemTest zero).</summary>
    public TimeSpan MinimumLeadTime { get; set; } = TimeSpan.Zero;

    /// <summary>The latest bookable start is now plus this many days.</summary>
    [Range(1, 365)]
    public int BookingHorizonDays { get; set; } = 90;

    /// <summary>How many alternative slots a 409 suggests.</summary>
    [Range(0, 10)]
    public int SuggestedSlotCount { get; set; } = 3;

    // BookingWindowPolicy requires horizon > lead time; checking here fails the deployment at startup instead of on the first request.
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // Range(Type, string, string) uses a trim-unsafe TypeConverter even under the options generator. Keep this typed and
        // field-keyed; [OptionsValidator] invokes IValidatableObject directly without reflection-based discovery.
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

/// <summary>Generated from the <see cref="SchedulingOptions"/> attributes (no reflection-based DataAnnotations validation, Addendum A §A4).</summary>
[OptionsValidator]
public sealed partial class SchedulingOptionsValidator : IValidateOptions<SchedulingOptions>;

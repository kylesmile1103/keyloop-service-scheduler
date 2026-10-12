using System.Collections.Frozen;

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>
/// The RFC 9457 problem type catalogue (ARCHITECTURE §8.7). <c>type</c> is <see cref="Base"/> + slug; clients branch on it, so the
/// slugs are stable API. Domain rule codes are slugs too (<see cref="ForRule"/>).
/// </summary>
public static class ProblemTypes
{
    public const string Base = "https://api.keyloop.example/problems/";

    public const string Unauthenticated = Base + "unauthenticated";
    public const string Forbidden = Base + "forbidden";
    public const string ValidationError = Base + "validation-error";
    public const string NotFound = Base + "not-found";
    public const string OutsideOperatingHours = Base + "outside-operating-hours";
    public const string LeadTimeNotMet = Base + "lead-time-not-met";
    public const string BeyondBookingHorizon = Base + "beyond-booking-horizon";
    public const string SlotNotAligned = Base + "slot-not-aligned";
    public const string NoQualifiedResources = Base + "no-qualified-resources";
    public const string VehicleProfileConflict = Base + "vehicle-profile-conflict";
    public const string VehicleAwareRequirementsDisabled = Base + "vehicle-aware-requirements-disabled";
    public const string IdempotencyKeyReuse = Base + "idempotency-key-reuse";
    public const string SlotUnavailable = Base + "slot-unavailable";
    public const string SlotConflict = Base + "slot-conflict";
    public const string InvalidStateTransition = Base + "invalid-state-transition";
    public const string NoShowBeforeSlotEnd = Base + "no-show-before-slot-end";
    public const string ConcurrencyConflict = Base + "concurrency-conflict";
    public const string RateLimited = Base + "rate-limited";
    public const string TriageUnavailable = Base + "triage-unavailable";
    public const string InternalError = Base + "internal-error";

    /// <summary>The title for a rule code that is not (yet) in the catalogue; its <c>type</c> is still <see cref="ForRule"/>.</summary>
    public const string UncataloguedRuleTitle = "Business rule violated";

    private static readonly FrozenDictionary<string, string> Titles = new Dictionary<string, string>
    {
        [Unauthenticated] = "Authentication required",
        [Forbidden] = "Forbidden",
        [ValidationError] = "Validation failed",
        [NotFound] = "Resource not found",
        [OutsideOperatingHours] = "Outside operating hours",
        [LeadTimeNotMet] = "Lead time not met",
        [BeyondBookingHorizon] = "Beyond booking horizon",
        [SlotNotAligned] = "Slot not aligned",
        [NoQualifiedResources] = "No qualified resources",
        [VehicleProfileConflict] = "Vehicle profile conflict",
        [VehicleAwareRequirementsDisabled] = "Vehicle-aware requirements disabled",
        [IdempotencyKeyReuse] = "Idempotency key reused",
        [SlotUnavailable] = "Slot unavailable",
        [SlotConflict] = "Slot conflict",
        [InvalidStateTransition] = "Invalid state transition",
        [NoShowBeforeSlotEnd] = "No-show before slot end",
        [ConcurrencyConflict] = "Concurrency conflict",
        [RateLimited] = "Too many requests",
        [TriageUnavailable] = "Service suggestions unavailable",
        [InternalError] = "Internal server error",
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>The problem type for a domain rule code (<c>DomainRuleViolationException.RuleCode</c> is the slug).</summary>
    public static string ForRule(string ruleCode) => Base + ruleCode;

    /// <summary>The catalogue's short, stable title for a problem type, or null when the type is not catalogued.</summary>
    public static string? TitleFor(string type) => Titles.GetValueOrDefault(type);
}

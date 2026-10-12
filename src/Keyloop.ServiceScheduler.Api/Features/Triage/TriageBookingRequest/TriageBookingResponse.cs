using Keyloop.ServiceScheduler.Api.Common.Contracts;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

/// <summary>Service suggestions for human confirmation. This operation never books an appointment.</summary>
/// <param name="Model">Configured model identifier.</param>
/// <param name="Recommendation">suggest, confirm or no-match. Always require a person's confirmation.</param>
/// <param name="ServiceConfidence">Clef's service confidence, distinct from a candidate's probability.</param>
/// <param name="Services">At most three bookable candidates meeting the absolute and relative probability floors, most likely first.</param>
/// <param name="PreferredDate">Confidently selected local date, including a closed day, or null.</param>
/// <param name="UncoveredIssue">A confidently selected additional issue outside the most likely service, or null. Render the category with fixed client copy, never model text, and only while the service it names is the one selected.</param>
public sealed record TriageBookingResponse(string Model, string Recommendation, double ServiceConfidence,
    IReadOnlyList<TriageServiceCandidate> Services, TriagePreferredDate? PreferredDate, TriageUncoveredIssue? UncoveredIssue);

/// <summary>A candidate from the dealership's bookable catalogue.</summary>
public sealed record TriageServiceCandidate(ServiceTypeSummary ServiceType, double Probability);
/// <summary>A concrete date in the dealership's zone. Availability still decides whether it has slots.</summary>
public sealed record TriagePreferredDate(DateOnly Date, double Probability, double Confidence);

/// <summary>A validated closed category, with confidence distinct from its probability. NONE and below-threshold answers return null.</summary>
/// <param name="Category">Closed UI-copy key for the additional issue.</param>
/// <param name="Probability">The category's probability in Clef's answer.</param>
/// <param name="Confidence">Clef's confidence in this answer, compared with the uncovered-issue threshold.</param>
/// <param name="OutsideServiceTypeId">The service type the issue is outside: Clef's most likely service, which need not be the first candidate a person picks. Null when Clef chose none of the bookable services, so the issue is outside the whole catalogue. Show the notice while this service is selected (or whenever it is null), not for another candidate.</param>
public sealed record TriageUncoveredIssue(TriageUncoveredCategory Category, double Probability, double Confidence, Guid? OutsideServiceTypeId);

/// <summary>Closed UI-copy keys for problems outside the most likely service. One appointment covers one service.</summary>
public enum TriageUncoveredCategory { ACCIDENT_OR_BODY_DAMAGE, LIGHTS_OR_ELECTRICAL_ACCESSORY, AIR_CONDITIONING, TYRES_OR_WHEELS, GLASS, OTHER }

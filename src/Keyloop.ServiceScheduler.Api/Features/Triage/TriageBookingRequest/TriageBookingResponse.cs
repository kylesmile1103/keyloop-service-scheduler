using Keyloop.ServiceScheduler.Api.Common.Contracts;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

/// <summary>Service suggestions for human confirmation. This operation never books an appointment.</summary>
/// <param name="Model">Configured model identifier.</param>
/// <param name="Recommendation">suggest, confirm or no-match. Always require a person's confirmation.</param>
/// <param name="ServiceConfidence">Jev's service confidence, distinct from a candidate's probability.</param>
/// <param name="Services">At most three bookable candidates above the configured probability floor, most likely first.</param>
/// <param name="PreferredDate">Confidently selected local date, including a closed day, or null.</param>
public sealed record TriageBookingResponse(string Model, string Recommendation, double ServiceConfidence,
    IReadOnlyList<TriageServiceCandidate> Services, TriagePreferredDate? PreferredDate);

/// <summary>A candidate from the dealership's bookable catalogue.</summary>
public sealed record TriageServiceCandidate(ServiceTypeSummary ServiceType, double Probability);
/// <summary>A concrete date in the dealership's zone. Availability still decides whether it has slots.</summary>
public sealed record TriagePreferredDate(DateOnly Date, double Probability, double Confidence);

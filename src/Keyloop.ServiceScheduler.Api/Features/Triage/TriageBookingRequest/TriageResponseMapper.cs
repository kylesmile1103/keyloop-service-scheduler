using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

internal static class TriageResponseMapper
{
    internal static TriageBookingResponse Map(string model, ClefEvaluation evaluation, IReadOnlyList<ServiceType> services,
        TriageOptions options)
    {
        var service = evaluation.Service;
        // Abstention is not a service candidate, so its probability must not raise the relative floor.
        var top = services.Count == 0 ? 0 : services.Max(s => service.Probabilities![s.Code]);
        var floor = Math.Max(options.CandidateFloor, options.RelativeCandidateFloor * top);
        var candidates = services.Select(s => new TriageServiceCandidate(new ServiceTypeSummary(s.Id, s.Code, s.Name, s.Duration.Minutes),
                service.Probabilities![s.Code]))
            .Where(s => s.Probability >= floor)
            // Clef's own choice leads whenever it clears the floor: the validator lets it sit up to 0.000001 under another service, and
            // the first card is the one a suggestion calls Likely and preselects, so a tie must not hand that place to another code.
            .OrderByDescending(s => s.ServiceType.Code == service.Choice).ThenByDescending(s => s.Probability)
            .ThenBy(s => s.ServiceType.Code, StringComparer.Ordinal).Take(3).ToList();
        var recommendation = service.Choice == ClefQuestionBuilder.NoneOfThese || candidates.Count == 0 ? "no-match"
            : service.Confidence >= options.SuggestThreshold ? "suggest" : "confirm";
        // The service the answer presents: none for a no-match (even when Clef named one under the floor), otherwise the first card.
        // The uncovered issue is judged against it, so it is never hidden by, or said to be outside, a service the person was not shown.
        var presented = recommendation == "no-match" ? ClefQuestionBuilder.NoneOfThese : candidates[0].ServiceType.Code;
        var date = evaluation.PreferredDate;
        var preferred = date.Choice != ClefQuestionBuilder.NoSpecificDate && date.Confidence >= options.DateThreshold
            ? new TriagePreferredDate(DateOnly.ParseExact(date.Choice!, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                date.Probabilities![date.Choice!], date.Confidence!.Value) : null;
        var uncovered = evaluation.UncoveredIssue;
        var issue = uncovered.Choice != ClefQuestionBuilder.NoUncoveredIssue && uncovered.Confidence >= options.UncoveredIssueThreshold
            && !UncoveredIssueScope.Covers(presented, uncovered.Choice!)
            ? new TriageUncoveredIssue(Category(uncovered.Choice!), uncovered.Probabilities![uncovered.Choice!], uncovered.Confidence!.Value,
                OutsideServiceTypeId(presented, services))
            : null;
        return new(model, recommendation, service.Confidence!.Value, candidates, preferred, issue);
    }

    private static Guid? OutsideServiceTypeId(string choice, IReadOnlyList<ServiceType> services) =>
        choice == ClefQuestionBuilder.NoneOfThese ? null : services.Single(s => s.Code == choice).Id;

    private static TriageUncoveredCategory Category(string choice) => choice switch
    {
        "ACCIDENT_OR_BODY_DAMAGE" => TriageUncoveredCategory.ACCIDENT_OR_BODY_DAMAGE,
        "LIGHTS_OR_ELECTRICAL_ACCESSORY" => TriageUncoveredCategory.LIGHTS_OR_ELECTRICAL_ACCESSORY,
        "AIR_CONDITIONING" => TriageUncoveredCategory.AIR_CONDITIONING,
        "TYRES_OR_WHEELS" => TriageUncoveredCategory.TYRES_OR_WHEELS,
        "GLASS" => TriageUncoveredCategory.GLASS,
        "OTHER" => TriageUncoveredCategory.OTHER,
        _ => throw new TriageUnavailableException("invalid-answer"),
    };
}

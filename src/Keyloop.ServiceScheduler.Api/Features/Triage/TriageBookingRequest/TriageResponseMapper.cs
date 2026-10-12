using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

internal static class TriageResponseMapper
{
    internal static TriageBookingResponse Map(string model, JevEvaluation evaluation, IReadOnlyList<ServiceType> services,
        TriageOptions options)
    {
        var service = evaluation.Service;
        var candidates = services.Select(s => new TriageServiceCandidate(new ServiceTypeSummary(s.Id, s.Code, s.Name, s.Duration.Minutes),
                service.Probabilities![s.Code]))
            .Where(s => s.Probability >= options.CandidateFloor).OrderByDescending(s => s.Probability)
            .ThenBy(s => s.ServiceType.Code, StringComparer.Ordinal).Take(3).ToList();
        var recommendation = service.Choice == JevQuestionBuilder.NoneOfThese || candidates.Count == 0 ? "no-match"
            : service.Confidence >= options.SuggestThreshold ? "suggest" : "confirm";
        var date = evaluation.PreferredDate;
        var preferred = date.Choice != JevQuestionBuilder.NoSpecificDate && date.Confidence >= options.DateThreshold
            ? new TriagePreferredDate(DateOnly.ParseExact(date.Choice!, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                date.Probabilities![date.Choice!], date.Confidence!.Value) : null;
        return new(model, recommendation, service.Confidence!.Value, candidates, preferred);
    }
}

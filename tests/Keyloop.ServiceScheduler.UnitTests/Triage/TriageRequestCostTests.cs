using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class TriageRequestCostTests(ITestOutputHelper output)
{
    [Fact]
    public void Third_question_stays_within_a_small_offline_input_budget_in_the_same_request()
    {
        var request = ClefQuestionBuilder.Build("@cf/cloudflare/clef-flash", "Crash damage and air conditioning will not switch on",
            ReferenceDataSeed.CreateServiceTypes(), ClefQuestionBuilderTests.Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 90);
        var withThird = JsonSerializer.Serialize(request, TriageJsonContext.Transport.ClefRequest);
        var twoQuestions = request with { Questions = request.Questions.Where(q => q.Key != "uncovered_issue").ToDictionary() };
        var withoutThird = JsonSerializer.Serialize(twoQuestions, TriageJsonContext.Transport.ClefRequest);
        var extraBytes = Encoding.UTF8.GetByteCount(withThird) - Encoding.UTF8.GetByteCount(withoutThird);
        // No vendor tokenizer is available offline. This is a planning estimate, not measured Clef usage.
        var estimatedExtraTokens = (int)Math.Ceiling(extraBytes / 4.0);
        output.WriteLine($"Third question: +{extraBytes} UTF-8 bytes; approximately +{estimatedExtraTokens} input tokens at 4 bytes/token. Exact usage awaits the approved live run.");
        extraBytes.ShouldBeInRange(1, 2200);
        request.Questions.Count.ShouldBe(3);
    }
}

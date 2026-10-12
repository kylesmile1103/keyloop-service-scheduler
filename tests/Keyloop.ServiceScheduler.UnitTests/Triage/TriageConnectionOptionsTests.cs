using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class TriageConnectionOptionsTests
{
    [Fact]
    public void Disabled_defaults_need_no_credentials() => new TriageConnectionOptionsValidator().Validate(null, new()).Succeeded.ShouldBeTrue();

    // Stakeholder decision for Clef (2026-10-12): the live text-only run had p95 2.4 s and a cold start beyond four seconds, and photos
    // add up to about 11 MB of request body. The image-path latency is still unmeasured (ARCHITECTURE §8.10).
    [Fact]
    public void Default_total_deadline_is_eight_seconds() => new TriageConnectionOptions().Timeout.ShouldBe(TimeSpan.FromSeconds(8));

    [Theory]
    [InlineData("", "test-token")]
    [InlineData("not-an-account", "test-token")]
    [InlineData("00000000000000000000000000000000", "")]
    [InlineData("00000000000000000000000000000000", "test-token\r\n")]
    public void Enabled_options_reject_missing_or_unsafe_credentials_without_echoing_them(string account, string token)
    {
        var result = new TriageConnectionOptionsValidator().Validate(null, new() { Enabled = true, AccountId = account, ApiToken = token });
        result.Failed.ShouldBeTrue();
        result.Failures.ShouldNotContain(f => f.Contains("test-token", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("http://triage.test", 4)]
    [InlineData("https://triage.test?token=test-token", 4)]
    [InlineData("https://triage.test", 0)]
    [InlineData("https://triage.test", 11)]
    public void Url_and_timeout_are_bounded(string url, int seconds) =>
        new TriageConnectionOptionsValidator().Validate(null, new() { BaseUrl = url, Timeout = TimeSpan.FromSeconds(seconds) }).Failed.ShouldBeTrue();
}

using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The two guards of <c>POST /api/v1/admin/demo/reseed</c> (Addendum C §C3, SYSTEM_DESIGN §11.2): the route is mapped only where demo
/// data is seeded and a key is configured (<see cref="DemoOptions.ReseedEnabled"/>), and a request passes only with exactly that key
/// (<see cref="ReseedDemoDataHandler.KeyMatches"/>). Each guard holds on its own: no configured key matches nothing, so a route mapped
/// by mistake still refuses every request, including one with an empty <c>X-Reseed-Key</c> header.
/// </summary>
public class ReseedDemoDataGuardTests
{
    // As long as the key the AppHost generates for each run.
    private const string Key = "0123456789abcdef0123456789abcdef";

    [Theory]
    [InlineData(true, Key, true)]
    [InlineData(false, Key, false)] // UAT and Production never seed demo data
    [InlineData(true, null, false)] // no key configured: nothing could ever call it
    [InlineData(true, "", false)]   // an empty value, as an unset environment variable binds, is no key either
    [InlineData(false, null, false)]
    public void Route_is_enabled_only_with_demo_data_and_a_configured_key(bool seedDemoData, string? configuredKey, bool enabled) =>
        new DemoOptions { ReseedKey = configuredKey }.ReseedEnabled(new DatabaseOptions { SeedDemoData = seedDemoData }).ShouldBe(enabled);

    [Fact]
    public void The_configured_key_matches() =>
        ReseedDemoDataHandler.KeyMatches(Key, Key).ShouldBeTrue();

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData(Key, null)]
    [InlineData(null, "")]
    [InlineData("", "")] // an empty header against an empty configured key: equal strings, still no match
    [InlineData(Key, "")]
    public void No_configured_key_matches_nothing(string? presented, string? configuredKey) =>
        ReseedDemoDataHandler.KeyMatches(presented, configuredKey).ShouldBeFalse();

    [Theory]
    [InlineData(null)]                                  // no header
    [InlineData("")]                                    // an empty header
    [InlineData("fedcba9876543210fedcba9876543210")]    // another key of the same length
    [InlineData("0123456789abcdef0123456789abcde")]     // a prefix of the key (a different length)
    [InlineData("0123456789abcdef0123456789abcdef0")]   // the key and more (a different length)
    [InlineData("0123456789ABCDEF0123456789ABCDEF")]    // the key in upper case: keys are case-sensitive
    [InlineData(" 0123456789abcdef0123456789abcdef")]   // the key with leading white space: compared as sent
    public void Any_other_presented_key_does_not_match(string? presented) =>
        ReseedDemoDataHandler.KeyMatches(presented, Key).ShouldBeFalse();
}

using Keyloop.ServiceScheduler.Api.Common.Authentication;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

public sealed class AuthUrlsTests
{
    [Theory]
    [InlineData("/board?date=2026-10-13", "/board?date=2026-10-13")]
    [InlineData(null, "/")]
    [InlineData("https://evil.test", "/")]
    [InlineData("//evil.test", "/")]
    [InlineData("/\\evil.test", "/")]
    [InlineData("/board\nLocation: https://evil.test", "/")]
    public void Return_target_is_local_and_has_no_controls_or_backslash(string? target, string expected) =>
        AuthUrls.SafeReturnTo(target).ShouldBe(expected);

    [Fact]
    public void Login_url_encodes_the_return_target() =>
        AuthUrls.Login("/board?date=2026-10-13").ShouldBe("/auth/login?returnTo=%2Fboard%3Fdate%3D2026-10-13");
}

using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

public sealed class AuthOptionsTests
{
    [Theory]
    [InlineData("Development", "Production")]
    [InlineData("Development", "Demo")]
    [InlineData("Development", "SystemTest")]
    [InlineData("None", "Development")]
    [InlineData("None", "Production")]
    public void Unsafe_modes_fail_outside_their_environment(string mode, string environment)
    {
        var options = new AuthOptions { Mode = Enum.Parse<AuthMode>(mode) };
        new AuthEnvironmentValidator(environment).Validate(null, options).Failed.ShouldBeTrue();
    }

    [Theory]
    [InlineData("https://team.cloudflareaccess.com", true)]
    [InlineData("https://team.cloudflareaccess.com/", false)]
    [InlineData("http://team.cloudflareaccess.com", false)]
    [InlineData("https://team.cloudflareaccess.com.evil.test", false)]
    [InlineData("https://team.cloudflareaccess.com/path", false)]
    [InlineData("https://user@team.cloudflareaccess.com", false)]
    [InlineData("https://team.cloudflareaccess.com:8443", false)]
    public void Access_requires_a_canonical_https_team_domain(string domain, bool valid)
    {
        var options = new AuthOptions { TeamDomain = domain, Audience = ["application-aud"] };
        new AuthOptionsValidator().Validate(null, options).Succeeded.ShouldBe(valid);
    }

    [Fact]
    public void Invalid_role_list_reports_only_the_member_not_the_personal_data()
    {
        var options = new AuthOptions { Mode = AuthMode.Development };
        options.Roles.Admin = ["invalid-personal-data"];
        var result = new AuthOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        string.Join(" ", result.Failures!).ShouldNotContain("invalid-personal-data");
    }
}

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

    [Theory]
    [InlineData(254, true)]
    [InlineData(255, false)]
    public void Emails_are_bounded_by_the_RFC_5321_path_length(int length, bool valid)
    {
        // 64-character local part, three 63-or-fewer-character labels and ".test".
        var email = $"{new string('a', 64)}@{new string('b', 63)}.{new string('c', 63)}.{new string('d', length - 198)}.test";
        email.Length.ShouldBe(length);
        AuthOptions.ValidEmail(email).ShouldBe(valid);
    }

    [Fact]
    public void The_audit_actor_column_holds_the_longest_verified_email()
    {
        Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors.CurrentActor.MaxLength
            .ShouldBeGreaterThanOrEqualTo("user:".Length + AuthOptions.MaxEmailLength);
    }
}

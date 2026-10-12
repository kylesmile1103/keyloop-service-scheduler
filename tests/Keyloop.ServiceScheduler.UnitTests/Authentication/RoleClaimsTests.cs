using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

public sealed class RoleClaimsTests
{
    [Theory]
    [InlineData("admin@keyloop.test", "Admin")]
    [InlineData("ADMIN@KEYLOOP.TEST", "Admin")]
    [InlineData("advisor@keyloop.test", "ServiceAdvisor")]
    [InlineData("reader@review.test", "Viewer")]
    [InlineData("reader@sub.review.test", null)]
    [InlineData("reader@review.test.evil.test", null)]
    [InlineData("unknown@keyloop.test", null)]
    public async Task Exact_email_or_exact_domain_grants_only_configured_roles(string email, string? role)
    {
        var options = new AuthOptions();
        options.Roles.Admin = ["admin@keyloop.test"];
        options.Roles.ServiceAdvisor = ["advisor@keyloop.test"];
        options.Roles.Viewer = ["@review.test"];
        var original = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], "test"));
        var transformation = new RoleClaimsTransformation(Options.Create(options));
        var result = await transformation.TransformAsync(original);
        var repeated = await transformation.TransformAsync(result);
        repeated.FindAll(ClaimTypes.Role).Select(claim => claim.Value).ShouldBe(role is null ? [] : new[] { role });
        original.FindAll(ClaimTypes.Role).ShouldBeEmpty("the cached authentication ticket is not mutated");
    }

    [Fact]
    public async Task Email_on_an_unauthenticated_identity_grants_no_role()
    {
        var options = new AuthOptions();
        options.Roles.Admin = ["admin@keyloop.test"];
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, "admin@keyloop.test")]));
        var result = await new RoleClaimsTransformation(Options.Create(options)).TransformAsync(principal);
        result.IsInRole("Admin").ShouldBeFalse();
    }
}

using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Authentication;

public sealed class PersonalDataTests
{
    private static readonly Vin SampleVin = Vin.Create("WVWZZZ1KZAW123456");

    [Theory]
    [InlineData("Admin")]
    [InlineData("ServiceAdvisor")]
    [InlineData("Viewer")]
    public void Any_API_role_receives_the_stored_values(string role)
    {
        var values = PersonalData.ForCaller(Caller(role), "Alice Louise Smith", SampleVin, "AB12 CDE");

        values.ShouldBe(new PersonalData.Values("Alice Louise Smith", "WVWZZZ1KZAW123456", "AB12 CDE"));
    }

    [Theory]
    [InlineData(null)] // anonymous or an invalid session
    [InlineData("")] // verified, but no configured role
    public void Callers_without_a_role_receive_initials_the_domain_VIN_mask_and_a_fully_masked_registration(string? role)
    {
        var values = PersonalData.ForCaller(Caller(role), "Alice Louise Smith", SampleVin, "AB12 CDE");

        values.ShouldBe(new PersonalData.Values("ALS", "***********123456", "*******"));
        values.Vin.ShouldBe(SampleVin.Masked, "the anonymous reads use the same VIN mask as logs and events");
    }

    [Fact]
    public void A_role_claim_on_an_unauthenticated_identity_does_not_unmask()
    {
        var unauthenticated = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, SchedulerRoles.Admin)]));

        PersonalData.ForCaller(unauthenticated, "Alice Smith", SampleVin, "AB12 CDE").CustomerName.ShouldBe("AS");
    }

    [Theory]
    [InlineData("Alice Louise Smith", "ALS")]
    [InlineData("  Alice   Louise\tSmith  ", "ALS")]
    [InlineData("(Bob) Smith", "BS")]
    [InlineData("\"Bob\" O'Brien-Smith", "BO")]
    [InlineData("alice smith", "AS")]
    [InlineData("Émile Zola", "ÉZ")]
    [InlineData("- Smith", "S")]
    [InlineData("Dr. 3rd Alice", "DRA")]
    [InlineData("𐐨lice Smith", "𐐀S")] // a supplementary-plane letter is one rune, upper-cased whole, never a lone surrogate
    [InlineData("1234 5678", "")]
    public void Initials_take_the_first_letter_of_each_whitespace_separated_part(string name, string initials)
    {
        PersonalData.Initials(name).ShouldBe(initials);
        PersonalData.Initials(name).ShouldNotContain('�');
        PersonalData.Initials(name).Any(char.IsSurrogate).ShouldBe(initials.Any(char.IsSurrogate));
    }

    [Theory]
    [InlineData("AB12 CDE")] // current UK format: the last three letters are its most distinctive part
    [InlineData("AB12CDE")]
    [InlineData("A123 BCD")]
    [InlineData("ABC 123")]
    [InlineData("AB-12-CD")]
    [InlineData("K1 NGS")]
    [InlineData("1 ABC")]
    [InlineData("A1")]
    public void Callers_without_a_role_see_no_character_of_any_registration(string registration)
    {
        var masked = PersonalData.ForCaller(Caller(null), "Alice Smith", SampleVin, registration).Registration;

        masked.ShouldBe("*******", "seven asterisks whatever the plate, so neither a suffix nor the plate's length is revealed");
        PersonalData.ForCaller(Caller(""), "Alice Smith", SampleVin, registration).Registration.ShouldBe(masked);
        PersonalData.ForCaller(Caller("Viewer"), "Alice Smith", SampleVin, registration).Registration.ShouldBe(registration);
    }

    private static ClaimsPrincipal Caller(string? role)
    {
        if (role is null)
        {
            return new ClaimsPrincipal(new ClaimsIdentity());
        }

        var identity = new ClaimsIdentity("Test");
        identity.AddClaim(new Claim(ClaimTypes.Email, "caller@keyloop.test"));
        if (role.Length > 0)
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }

        return new ClaimsPrincipal(identity);
    }
}

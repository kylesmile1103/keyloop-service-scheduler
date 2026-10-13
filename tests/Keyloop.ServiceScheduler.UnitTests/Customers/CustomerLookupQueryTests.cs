using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

namespace Keyloop.ServiceScheduler.UnitTests.Customers;

public sealed class CustomerLookupQueryTests
{
    [Theory]
    [InlineData("ALICE@", "Email")]
    [InlineData("123456@", "Email")]
    [InlineData("+44 (7700) 900-123", "Phone")]
    [InlineData("900123", "Phone")]
    [InlineData("12345", "RegistrationOrName")]
    [InlineData("AB123456", "RegistrationOrName")]
    [InlineData("AB12 CDE", "RegistrationOrName")]
    [InlineData("Smith", "RegistrationOrName")]
    [InlineData("++++++123456", "RegistrationOrName")]
    public void Shape_classifies_without_guessing_at_registration_digits(string query, string kind) =>
        CustomerLookupQuery.Kind(query).ToString().ShouldBe(kind);

    [Fact]
    public void Phone_normalization_and_like_escaping_are_literal()
    {
        CustomerLookupQuery.Digits("+44 (7700) 900-123").ShouldBe("447700900123");
        CustomerLookupQuery.Prefix(@"a%_\b").ShouldBe(@"a\%\_\\b%");
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("  a  ", false)]
    [InlineData(" ab ", true)]
    public async Task Validator_measures_trimmed_query(string? query, bool valid) =>
        (await new FindReturningCustomersValidator().ValidateAsync(new FindReturningCustomersRequest(query!), TestContext.Current.CancellationToken)).IsValid.ShouldBe(valid);

    [Theory]
    [InlineData(100, true)]
    [InlineData(101, false)]
    public async Task Validator_bounds_query_length(int length, bool valid) =>
        (await new FindReturningCustomersValidator().ValidateAsync(new FindReturningCustomersRequest(" " + new string('a', length) + " "), TestContext.Current.CancellationToken)).IsValid.ShouldBe(valid);
}

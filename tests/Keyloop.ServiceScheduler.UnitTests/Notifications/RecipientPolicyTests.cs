using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

public sealed class RecipientPolicyTests
{
    [Theory]
    [InlineData("olivia.bennett@example.com")] // every demo customer (DemoAppointmentSeeder)
    [InlineData("a@example.net")]
    [InlineData("a@example.org")]
    [InlineData("a@mail.example.com")]
    [InlineData("A@Mail.EXAMPLE.ORG")]
    [InlineData("a@example.com.")]
    [InlineData("a@workshop.example")]
    [InlineData("a@example")]
    [InlineData("a@garage.test")]
    [InlineData("a@test")]
    [InlineData("a@nowhere.invalid")]
    [InlineData("a@localhost")]
    [InlineData("a@api.localhost")]
    [InlineData("Jane <jane@example.com>")]
    [InlineData("\"quoted\"@example.com")]
    public void Reserved_documentation_and_test_names_are_never_sent_to(string recipient) =>
        RecipientPolicy.IsReservedDomain(recipient).ShouldBeTrue();

    [Theory]
    [InlineData("jane@inbox.keyloop.local")]
    [InlineData("jane@example.co.uk")]
    [InlineData("jane@myexample.com")]
    [InlineData("jane@example.com.au")]
    [InlineData("jane@testing.dev")]
    [InlineData("jane@gmail.com")]
    [InlineData("not-an-address")]
    [InlineData("")]
    public void Other_domains_are_left_to_the_sender(string recipient) =>
        RecipientPolicy.IsReservedDomain(recipient).ShouldBeFalse();
}

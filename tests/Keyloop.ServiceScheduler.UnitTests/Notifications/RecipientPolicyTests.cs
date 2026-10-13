using Keyloop.ServiceScheduler.Infrastructure.Notifications;

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

    /// <summary>
    /// Verifies that reserved domain evaluation never throws on malformed recipient strings.
    /// </summary>
    [Fact]
    public void Never_throws_on_malformed_input()
    {
        string[] samples =
        [
            "", " ", "@", "@@", "a@", "@b", "<>", "<@>", "a@<", "a@>", "\"", "\"@\"", "a@[127.0.0.1]", "a@.", "a@..", ".@.", "a@ ", " @ ",
            "a@\r\nexample.com", "=?utf-8?q?x?=@example.com", "a@\u00e9xample.com", "a@b@c@example.com", "(comment)a@example.com",
            "Jane <jane@example.com", "Jane jane@example.com>", "\"unterminated@example.com", "a@xn--", "a@-.example",
            new string('a', 300) + "@" + new string('b', 300), new string('@', 254), new string('.', 254),
        ];
        const string alphabet = "aZ09@.<>\"()[]:;,\\ -_+=?!#\r\n\t\u00e9\u4e2d";
        var random = new Random(19);
        var generated = Enumerable.Range(0, 5000)
            .Select(_ => new string([.. Enumerable.Range(0, random.Next(0, 48)).Select(_ => alphabet[random.Next(alphabet.Length)])]));

        foreach (var recipient in samples.Concat(generated))
        {
            Should.NotThrow(() => RecipientPolicy.IsReservedDomain(recipient), recipient);
        }
    }
}

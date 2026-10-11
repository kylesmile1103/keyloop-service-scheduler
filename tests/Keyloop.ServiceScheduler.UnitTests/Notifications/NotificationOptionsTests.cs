using Keyloop.ServiceScheduler.Api.Common.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

public sealed class NotificationOptionsTests
{
    [Theory]
    [InlineData(NotificationProvider.None, false)]
    [InlineData(NotificationProvider.Smtp, true)]
    [InlineData(NotificationProvider.Cloudflare, true)]
    public void Accepts_supported_providers_including_the_future_cloudflare_adapter(NotificationProvider provider, bool enabled) =>
        new NotificationOptionsValidator().Validate(null, new NotificationOptions { Provider = provider, Enabled = enabled }).Succeeded.ShouldBeTrue();

    public static TheoryData<Action<NotificationOptions>> Invalid => new()
    {
        o => o.Provider = (NotificationProvider)999,
        o => o.Enabled = true,
        o => o.FromAddress = "bad-address",
        o => o.FromAddress = "a@example.com\r\nBcc: bad@example.com",
        o => o.FromDisplayName = "bad\nheader",
        o => o.ReplyTo = "invalid",
        o => o.PollInterval = TimeSpan.Zero,
        o => o.BatchSize = 0,
        o => o.MaxAttempts = 0,
        o => o.InitialBackoff = TimeSpan.Zero,
        o => o.MaxBackoff = TimeSpan.FromSeconds(1),
        o => o.SendTimeout = TimeSpan.Zero,
        o => o.ClaimLease = o.SendTimeout,
        o => { o.Provider = NotificationProvider.Smtp; o.Smtp.Host = ""; },
        o => { o.Provider = NotificationProvider.Smtp; o.Smtp.Port = 65536; },
        o => { o.Provider = NotificationProvider.Smtp; o.Smtp.Encryption = (SmtpEncryption)999; },
        o => { o.Provider = NotificationProvider.Smtp; o.Smtp.Username = "user"; },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public void Rejects_invalid_configuration_without_echoing_values(Action<NotificationOptions> mutate)
    {
        var options = new NotificationOptions();
        mutate(options);
        var result = new NotificationOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        string.Join(" ", result.Failures).ShouldNotContain("bad@example.com");
    }
}

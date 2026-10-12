using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;

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
        o => o.IdleInterval = TimeSpan.Zero,
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

    public static TheoryData<string, Action<NotificationOptions>> OutOfRange => new()
    {
        // Typed bounds (A4: no RangeAttribute(Type, string, string), which is not trim-safe); each names its member.
        { nameof(NotificationOptions.IdleInterval), o => o.IdleInterval = TimeSpan.FromMilliseconds(999) },
        { nameof(NotificationOptions.IdleInterval), o => o.IdleInterval = TimeSpan.FromHours(1) + TimeSpan.FromTicks(1) },
        { nameof(NotificationOptions.InitialBackoff), o => o.InitialBackoff = TimeSpan.FromMilliseconds(99) },
        { nameof(NotificationOptions.InitialBackoff), o => { o.InitialBackoff = TimeSpan.FromDays(1) + TimeSpan.FromTicks(1); o.MaxBackoff = TimeSpan.FromDays(2); } },
        { nameof(NotificationOptions.MaxBackoff), o => o.MaxBackoff = TimeSpan.FromDays(7) + TimeSpan.FromTicks(1) },
        { nameof(NotificationOptions.SendTimeout), o => o.SendTimeout = TimeSpan.FromMilliseconds(999) },
        { nameof(NotificationOptions.SendTimeout), o => { o.SendTimeout = TimeSpan.FromMinutes(5) + TimeSpan.FromTicks(1); o.ClaimLease = TimeSpan.FromMinutes(10); } },
        { nameof(NotificationOptions.ClaimLease), o => { o.SendTimeout = TimeSpan.FromSeconds(1); o.ClaimLease = TimeSpan.FromMilliseconds(1999); } },
        { nameof(NotificationOptions.ClaimLease), o => o.ClaimLease = TimeSpan.FromMinutes(30) + TimeSpan.FromTicks(1) },
    };

    [Theory]
    [MemberData(nameof(OutOfRange))]
    public void Rejects_time_spans_outside_their_bounds_by_member(string member, Action<NotificationOptions> mutate)
    {
        var options = new NotificationOptions();
        mutate(options);
        var result = new NotificationOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        result.Failures.ShouldContain(f => f.Contains(member, StringComparison.Ordinal));
    }

    [Fact]
    public void Accepts_the_bounds_themselves()
    {
        var options = new NotificationOptions
        {
            IdleInterval = TimeSpan.FromSeconds(1), InitialBackoff = TimeSpan.FromMilliseconds(100), MaxBackoff = TimeSpan.FromDays(7),
            SendTimeout = TimeSpan.FromMinutes(5), ClaimLease = TimeSpan.FromMinutes(30),
        };
        new NotificationOptionsValidator().Validate(null, options).Succeeded.ShouldBeTrue();
        options = new NotificationOptions { IdleInterval = TimeSpan.FromHours(1), InitialBackoff = TimeSpan.FromDays(1), MaxBackoff = TimeSpan.FromDays(1) };
        new NotificationOptionsValidator().Validate(null, options).Succeeded.ShouldBeTrue();
    }

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

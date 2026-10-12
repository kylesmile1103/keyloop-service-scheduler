using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

/// <summary>
/// A3: the provider-neutral envelope carries only the notification (outbox) id; providers correlate through the
/// <c>X-Keyloop-Notification-Id</c> header, and only the SMTP sender derives a Message-Id (Cloudflare rejects a caller-set one).
/// </summary>
public sealed class EmailCorrelationTests
{
    private static readonly Guid Id = Guid.Parse("01234567-89ab-7cde-8fab-0123456789ab");

    [Fact]
    public void Providers_correlate_through_the_notification_id_header() =>
        EmailMessage.NotificationIdHeader.ShouldBe("X-Keyloop-Notification-Id");

    [Fact]
    public void The_smtp_message_id_is_stable_for_the_notification_id() =>
        SmtpEmailSender.MessageIdFor(Id).ShouldBe("0123456789ab7cde8fab0123456789ab@service-scheduler.keyloop.example");
}

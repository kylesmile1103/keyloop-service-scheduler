namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Provider-independent email envelope correlated with its outbox row via <see cref="NotificationId"/> and <see cref="NotificationIdHeader"/>.
/// </summary>
public sealed record EmailMessage(Guid NotificationId, string Recipient, string Subject, string TextBody, string HtmlBody)
{
    public const string NotificationIdHeader = "X-Keyloop-Notification-Id";
}

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

public enum NotificationKind { BookingConfirmation, Cancellation }

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Provider-independent envelope. <see cref="NotificationId"/> is the outbox id, the same on every attempt; every provider sends it as
/// the <see cref="NotificationIdHeader"/> header, which is how a delivered email is correlated with its row. Provider-specific headers
/// are derived by the sender, never carried here: SMTP derives a stable Message-Id from the id, while Cloudflare Email Service rejects
/// a caller-set Message-ID (<c>E_HEADER_NOT_ALLOWED</c>) and has no idempotency key (SYSTEM_DESIGN §8.9).
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

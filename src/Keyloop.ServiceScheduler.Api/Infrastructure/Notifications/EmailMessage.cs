namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

/// <summary>Provider-independent envelope; the outbox id is the stable idempotency reference on every attempt.</summary>
public sealed record EmailMessage(Guid OutboxId, string Recipient, string Subject, string TextBody, string HtmlBody)
{
    public string MessageId => $"{OutboxId:N}@service-scheduler.keyloop.example";
}

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

public enum NotificationKind { BookingConfirmation, Cancellation }

public sealed record NotificationDetails(
    Guid AppointmentId, string Recipient, string DealershipName, string ServiceName, string TimeZoneId,
    DateTime StartUtc, DateTime EndUtc, string Registration, string Vin, string? CancellationReason);

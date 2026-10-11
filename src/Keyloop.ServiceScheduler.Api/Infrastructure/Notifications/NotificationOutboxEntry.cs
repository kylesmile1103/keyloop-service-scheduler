namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

public enum NotificationStatus { Pending, Sent, Failed }

/// <summary>Immutable content and durable delivery state. Pending includes leased rows, whose next attempt is the lease expiry.</summary>
public sealed class NotificationOutboxEntry
{
    private NotificationOutboxEntry() { }
    public Guid Id { get; private set; }
    public Guid AppointmentId { get; private set; }
    public NotificationKind Kind { get; private set; }
    public string Recipient { get; private set; } = string.Empty;
    public string Subject { get; private set; } = string.Empty;
    public string TextBody { get; private set; } = string.Empty;
    public string HtmlBody { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }
    public DateTime NextAttemptAt { get; private set; }
    public NotificationStatus Status { get; private set; }
    public int Attempts { get; private set; }
    public Guid? ClaimToken { get; private set; }
    public DateTime? SentAt { get; private set; }
    /// <summary>A fixed category only; provider exceptions may contain PII and are never persisted or logged.</summary>
    public string? LastFailure { get; private set; }

    public static NotificationOutboxEntry Create(NotificationKind kind, NotificationDetails details, DateTime occurredAtUtc)
    {
        ArgumentNullException.ThrowIfNull(details);
        if (occurredAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("An outbox timestamp must be UTC.", nameof(occurredAtUtc));
        }
        var id = Guid.CreateVersion7(new DateTimeOffset(occurredAtUtc, TimeSpan.Zero));
        var message = NotificationTemplate.Render(id, kind, details);
        return new NotificationOutboxEntry
        {
            Id = id, AppointmentId = details.AppointmentId, Kind = kind, Recipient = message.Recipient,
            Subject = message.Subject, TextBody = message.TextBody, HtmlBody = message.HtmlBody,
            CreatedAt = occurredAtUtc, NextAttemptAt = occurredAtUtc,
        };
    }

    public EmailMessage ToMessage() => new(Id, Recipient, Subject, TextBody, HtmlBody);

    public void MarkExhausted()
    {
        Status = NotificationStatus.Failed;
        ClaimToken = null;
        LastFailure = "LeaseExpired";
    }

    public void Claim(DateTime nowUtc, TimeSpan lease)
    {
        ClaimToken = Guid.NewGuid();
        Attempts++;
        NextAttemptAt = nowUtc + lease;
    }
}

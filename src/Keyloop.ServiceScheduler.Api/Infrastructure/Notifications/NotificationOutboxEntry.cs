using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

/// <summary>
/// Pending includes leased rows, whose next attempt is the lease expiry. Sent, Failed (dead letter) and Suppressed (never sent, by the
/// recipient policy) are terminal.
/// </summary>
public enum NotificationStatus { Pending, Sent, Failed, Suppressed }

/// <summary>The fixed categories stored in <see cref="NotificationOutboxEntry.LastFailure"/>; provider text is never stored or logged.</summary>
public static class NotificationOutcomes
{
    public const string Timeout = "Timeout";
    public const string SenderError = "SenderError";
    public const string LeaseExpired = "LeaseExpired";
    public const string RenderFailed = "RenderFailed";
    public const string ReservedDomain = "ReservedDomain";
}

/// <summary>Immutable appointment snapshot and durable delivery state (SYSTEM_DESIGN §8.9).</summary>
public sealed class NotificationOutboxEntry
{
    private NotificationOutboxEntry() { }
    public Guid Id { get; private set; }
    public Guid AppointmentId { get; private set; }
    public NotificationKind Kind { get; private set; }
    /// <summary>A column of its own: the dispatcher's recipient policy (and Task 20's caps) read it without the payload.</summary>
    public string Recipient { get; private set; } = string.Empty;
    /// <summary>The <see cref="NotificationSnapshot"/> as JSON (a <c>jsonb</c> column), rendered into the email at dispatch.</summary>
    public string Payload { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }
    public DateTime NextAttemptAt { get; private set; }
    public NotificationStatus Status { get; private set; }
    public int Attempts { get; private set; }
    public Guid? ClaimToken { get; private set; }
    public DateTime? SentAt { get; private set; }
    /// <summary>A fixed <see cref="NotificationOutcomes"/> category: the last failure, or why the row was suppressed.</summary>
    public string? LastFailure { get; private set; }

    /// <summary>
    /// Staged inside the booking or cancel's SaveChanges: in-memory work only, so it cannot fail or slow the change. The fixed recipient
    /// policy is applied here: a row for a reserved domain is staged <see cref="NotificationStatus.Suppressed"/>, never Pending, so it is
    /// neither claimed nor counted as backlog, whether or not dispatch is enabled (SYSTEM_DESIGN §8.9, §12.3).
    /// </summary>
    public static NotificationOutboxEntry Create(NotificationKind kind, string recipient, NotificationSnapshot snapshot, DateTime occurredAtUtc)
    {
        ArgumentNullException.ThrowIfNull(recipient);
        ArgumentNullException.ThrowIfNull(snapshot);
        if (occurredAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("An outbox timestamp must be UTC.", nameof(occurredAtUtc));
        }
        var entry = new NotificationOutboxEntry
        {
            Id = Guid.CreateVersion7(new DateTimeOffset(occurredAtUtc, TimeSpan.Zero)), AppointmentId = snapshot.AppointmentId, Kind = kind,
            Recipient = recipient, Payload = JsonSerializer.Serialize(snapshot, SchedulerJsonContext.Default.NotificationSnapshot),
            CreatedAt = occurredAtUtc, NextAttemptAt = occurredAtUtc,
        };
        if (RecipientPolicy.IsReservedDomain(recipient))
        {
            entry.Suppress(NotificationOutcomes.ReservedDomain);
        }
        return entry;
    }

    public NotificationSnapshot ReadSnapshot() =>
        JsonSerializer.Deserialize(Payload, SchedulerJsonContext.Default.NotificationSnapshot)
            ?? throw new JsonException("The notification payload is empty.");

    public void Claim(DateTime nowUtc, TimeSpan lease)
    {
        ClaimToken = Guid.NewGuid();
        Attempts++;
        NextAttemptAt = nowUtc + lease;
    }

    public void MarkExhausted()
    {
        Status = NotificationStatus.Failed;
        ClaimToken = null;
        LastFailure = NotificationOutcomes.LeaseExpired;
    }

    public void Suppress(string reason)
    {
        Status = NotificationStatus.Suppressed;
        ClaimToken = null;
        LastFailure = reason;
    }
}

using Keyloop.ServiceScheduler.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.UnitTests.Notifications;

public sealed class NotificationOutboxEntryTests
{
    private static readonly DateTime BookedAt = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);

    private static readonly NotificationSnapshot Snapshot = new(
        Guid.CreateVersion7(), Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc),
        new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), "AB12 CDE", "3456");

    [Theory]
    [InlineData(NotificationKind.BookingConfirmation, "olivia.bennett@example.com")] // every demo customer (DemoAppointmentSeeder)
    [InlineData(NotificationKind.Cancellation, "olivia.bennett@example.com")]
    [InlineData(NotificationKind.BookingConfirmation, "Jane <jane@garage.test>")]
    public void A_reserved_recipient_is_staged_suppressed_so_it_is_never_backlog(NotificationKind kind, string recipient)
    {
        var entry = NotificationOutboxEntry.Create(kind, recipient, Snapshot, BookedAt);

        (entry.Status, entry.LastFailure).ShouldBe((NotificationStatus.Suppressed, NotificationOutcomes.ReservedDomain));
        (entry.Attempts, entry.ClaimToken, entry.SentAt).ShouldBe((0, (Guid?)null, (DateTime?)null), "no lease, attempt or send");
        (entry.Kind, entry.Recipient, entry.CreatedAt).ShouldBe((kind, recipient, BookedAt), "the row still records what was not sent");
    }

    [Fact]
    public void A_deliverable_recipient_is_staged_pending_and_due_at_once()
    {
        var entry = NotificationOutboxEntry.Create(NotificationKind.BookingConfirmation, "jane@inbox.keyloop.local", Snapshot, BookedAt);

        (entry.Status, entry.LastFailure, entry.Attempts, entry.NextAttemptAt).ShouldBe((NotificationStatus.Pending, (string?)null, 0, BookedAt));
    }
}

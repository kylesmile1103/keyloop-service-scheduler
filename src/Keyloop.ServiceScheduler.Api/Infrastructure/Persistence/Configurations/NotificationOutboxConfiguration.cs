using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Configurations;

public sealed class NotificationOutboxConfiguration : IEntityTypeConfiguration<NotificationOutboxEntry>
{
    public void Configure(EntityTypeBuilder<NotificationOutboxEntry> builder)
    {
        builder.ToTable("notification_outbox", table =>
        {
            table.HasCheckConstraint("ck_notification_outbox_attempts", "attempts >= 0");
            table.HasCheckConstraint("ck_notification_outbox_status", "status IN ('Pending', 'Sent', 'Failed')");
            table.HasCheckConstraint("ck_notification_outbox_kind", "kind IN ('BookingConfirmation', 'Cancellation')");
        });
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.Kind).HasConversion<string>().HasMaxLength(32);
        builder.Property(e => e.Status).HasConversion<string>().HasMaxLength(16);
        builder.Property(e => e.Recipient).HasMaxLength(254);
        builder.Property(e => e.Subject).HasMaxLength(200);
        builder.Property(e => e.LastFailure).HasMaxLength(32);
        builder.HasOne<Appointment>().WithMany().HasForeignKey(e => e.AppointmentId).OnDelete(DeleteBehavior.Cascade);
        // Deferrability is appended in the migration: a stale cancellation must reach its xmin UPDATE before any duplicate email
        // check. An immediate unique index could fail first and turn the required 409 concurrency-conflict into a 500.
        builder.HasAlternateKey(e => new { e.AppointmentId, e.Kind }).HasName("ak_notification_outbox_appointment_id_kind");
        builder.HasIndex(e => new { e.NextAttemptAt, e.Id }).HasFilter("status = 'Pending'");
    }
}

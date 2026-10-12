using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Configurations;

internal sealed class AppointmentHistoryConfiguration : IEntityTypeConfiguration<AppointmentHistoryEntry>
{
    public void Configure(EntityTypeBuilder<AppointmentHistoryEntry> builder)
    {
        builder.ToTable("appointment_history");
        builder.HasKey(h => h.Id);
        builder.Property(h => h.Id).ValueGeneratedNever();
        builder.Property(h => h.EventType).HasMaxLength(40);
        builder.Property(h => h.Actor).HasMaxLength(100);
        builder.Property(h => h.Payload).HasColumnType("jsonb");
        builder.HasIndex(h => new { h.AppointmentId, h.OccurredAtUtc });
        builder.HasOne<Appointment>().WithMany().HasForeignKey(h => h.AppointmentId).OnDelete(DeleteBehavior.Cascade);
    }
}

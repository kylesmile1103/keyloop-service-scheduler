using Keyloop.ServiceScheduler.Domain.Dealerships;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Configurations;

internal sealed class DealershipConfiguration : IEntityTypeConfiguration<Dealership>
{
    public void Configure(EntityTypeBuilder<Dealership> builder)
    {
        builder.ToTable("dealerships");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Id).ValueGeneratedNever();
        builder.Property(d => d.Name).HasMaxLength(200);
        builder.Property(d => d.TimeZoneId).HasMaxLength(64);
        builder.Ignore(d => d.TimeZone);
        builder.Ignore(d => d.DomainEvents);

        // OperatingHours has no columns of its own; its seven days live in dealership_operating_hours keyed by
        // (dealership_id, day_of_week) (SYSTEM_DESIGN §8.8). Required, so EF never treats the column-less owner as absent.
        builder.OwnsOne(d => d.Hours, hours =>
        {
            hours.WithOwner();
            hours.OwnsMany(h => h.Days, day =>
            {
                day.ToTable("dealership_operating_hours");
                day.WithOwner().HasForeignKey("DealershipId");
                day.Property<Guid>("DealershipId").HasColumnName("dealership_id");
                day.Property(d => d.Day).HasColumnName("day_of_week").HasConversion<short>();
                day.HasKey("DealershipId", nameof(DayOperatingHours.Day));
                day.Property(d => d.OpensAt).HasColumnName("opens_at");
                day.Property(d => d.ClosesAt).HasColumnName("closes_at");
                day.Ignore(d => d.IsClosed);
                day.ToTable(t => t.HasCheckConstraint(
                    "ck_dealership_operating_hours_whole_minutes",
                    "EXTRACT(SECOND FROM opens_at) = 0 AND EXTRACT(SECOND FROM closes_at) = 0"));
                day.ToTable(t => t.HasCheckConstraint(
                    "ck_dealership_operating_hours_open_before_close",
                    "(opens_at IS NULL AND closes_at IS NULL) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)"));
            });
        });
        builder.Navigation(d => d.Hours).IsRequired();
    }
}

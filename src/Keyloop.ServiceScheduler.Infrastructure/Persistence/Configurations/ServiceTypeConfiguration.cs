using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class ServiceTypeConfiguration : IEntityTypeConfiguration<ServiceType>
{
    public void Configure(EntityTypeBuilder<ServiceType> builder)
    {
        builder.ToTable("service_types", t => t.HasCheckConstraint(
            "ck_service_types_duration_minutes", "duration_minutes > 0 AND duration_minutes % 5 = 0 AND duration_minutes <= 480"));
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Code).HasMaxLength(32);
        builder.HasIndex(s => s.Code).IsUnique();
        builder.Property(s => s.Name).HasMaxLength(120);
        builder.Property(s => s.Duration)
            .HasColumnName("duration_minutes")
            .HasConversion(d => d.Minutes, minutes => ServiceDuration.Create(minutes));
        builder.Property(s => s.RequiredBayCapabilities)
            .HasColumnName("required_bay_capabilities")
            .HasColumnType("text[]")
            .HasConversion(EnumArrayConversions.Converter<BayCapability>(), EnumArrayConversions.Comparer<BayCapability>());
        builder.Property(s => s.RequiredCertifications)
            .HasColumnName("required_certifications")
            .HasColumnType("text[]")
            .HasConversion(EnumArrayConversions.Converter<Certification>(), EnumArrayConversions.Comparer<Certification>());
    }
}

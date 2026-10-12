using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class TechnicianConfiguration : IEntityTypeConfiguration<Technician>
{
    public void Configure(EntityTypeBuilder<Technician> builder)
    {
        builder.ToTable("technicians");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();
        builder.Property(t => t.Name).HasMaxLength(120);
        builder.Property(t => t.EmployeeNumber).HasMaxLength(32);
        builder.Property(t => t.Certifications)
            .HasColumnName("certifications")
            .HasColumnType("text[]")
            .HasConversion(EnumArrayConversions.Converter<Certification>(), EnumArrayConversions.Comparer<Certification>());
        builder.HasIndex(t => t.Certifications).HasMethod("gin");
        builder.HasIndex(t => new { t.DealershipId, t.EmployeeNumber }).IsUnique();
        builder.HasOne<Dealership>().WithMany().HasForeignKey(t => t.DealershipId).OnDelete(DeleteBehavior.Cascade);
    }
}

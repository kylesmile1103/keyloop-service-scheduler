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
        builder.ToTable("technicians", t => t.HasCheckConstraint("ck_technicians_hv_level", "hv_level BETWEEN 0 AND 4"));
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();
        builder.Property(t => t.Name).HasMaxLength(120);
        builder.Property(t => t.EmployeeNumber).HasMaxLength(32);
        builder.Property(t => t.Certifications)
            .HasColumnName("certifications")
            .HasColumnType("text[]")
            .HasConversion(EnumArrayConversions.Converter<Certification>(), EnumArrayConversions.Comparer<Certification>());
        builder.Property(t => t.HvLevel).HasColumnType("smallint").HasDefaultValue(0);
        builder.Property(t => t.HvLevelConfirmed).HasDefaultValue(false);
        builder.Property(t => t.BrandSpecialisms).HasColumnType("text[]").HasDefaultValueSql("'{}'::text[]")
            .HasConversion(StringSetConversions.Converter(), StringSetConversions.Comparer());
        builder.HasIndex(t => t.BrandSpecialisms).HasMethod("gin");
        builder.HasIndex(t => t.Certifications).HasMethod("gin");
        builder.HasIndex(t => new { t.DealershipId, t.EmployeeNumber }).IsUnique();
        builder.HasOne<Dealership>().WithMany().HasForeignKey(t => t.DealershipId).OnDelete(DeleteBehavior.Cascade);
    }
}

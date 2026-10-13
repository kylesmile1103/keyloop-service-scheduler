using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class ServiceBayConfiguration : IEntityTypeConfiguration<ServiceBay>
{
    public void Configure(EntityTypeBuilder<ServiceBay> builder)
    {
        builder.ToTable("service_bays");
        builder.Property(r => r.RowVersion).IsRowVersion();
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Id).ValueGeneratedNever();
        builder.Property(b => b.Name).HasMaxLength(100);
        builder.Property(b => b.Capabilities)
            .HasColumnName("capabilities")
            .HasColumnType("text[]")
            .HasConversion(EnumArrayConversions.Converter<BayCapability>(), EnumArrayConversions.Comparer<BayCapability>());
        builder.HasIndex(b => b.Capabilities).HasMethod("gin");
        builder.HasOne<Dealership>().WithMany().HasForeignKey(b => b.DealershipId).OnDelete(DeleteBehavior.Cascade);
    }
}

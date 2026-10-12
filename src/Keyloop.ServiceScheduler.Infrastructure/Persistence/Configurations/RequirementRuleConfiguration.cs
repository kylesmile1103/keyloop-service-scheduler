using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class RequirementRuleConfiguration : IEntityTypeConfiguration<RequirementRule>
{
    public void Configure(EntityTypeBuilder<RequirementRule> builder)
    {
        builder.ToTable("requirement_rules", t =>
        {
            t.HasCheckConstraint("ck_requirement_rules_hv_level", "minimum_hv_level BETWEEN 0 AND 4");
            t.HasCheckConstraint("ck_requirement_rules_policy_version", "policy_version > 0");
        });
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();
        builder.Property(r => r.Code).HasMaxLength(64);
        builder.Property(r => r.Condition).HasConversion<string>().HasMaxLength(32);
        builder.Property(r => r.VehicleClass).HasConversion<string>().HasMaxLength(32);
        builder.Property(r => r.Powertrains).HasConversion(p => p.Select(v => v.ToString()).ToArray(), p => p.Select(v => Enum.Parse<Powertrain>(v)).ToArray()).HasColumnType("text[]");
        builder.Property(r => r.BayCapabilities).HasConversion(p => p.Select(v => v.ToString()).ToArray(), p => p.Select(v => Enum.Parse<Domain.Resources.BayCapability>(v)).ToArray()).HasColumnType("text[]");
        builder.Property(r => r.Certifications).HasConversion(p => p.Select(v => v.ToString()).ToArray(), p => p.Select(v => Enum.Parse<Domain.Resources.Certification>(v)).ToArray()).HasColumnType("text[]");
        builder.Property(r => r.Powertrains).Metadata.SetValueComparer(EnumArrayConversions.ArrayComparer<Powertrain>());
        builder.Property(r => r.BayCapabilities).Metadata.SetValueComparer(EnumArrayConversions.ArrayComparer<Domain.Resources.BayCapability>());
        builder.Property(r => r.Certifications).Metadata.SetValueComparer(EnumArrayConversions.ArrayComparer<Domain.Resources.Certification>());
        builder.Property(r => r.ServiceCodes).HasColumnType("text[]");
        builder.HasIndex(r => new { r.DealershipId, r.PolicyVersion, r.Code }).IsUnique();
        builder.HasOne<Dealership>().WithMany().HasForeignKey(r => r.DealershipId).OnDelete(DeleteBehavior.Cascade);
    }
}

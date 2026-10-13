using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class AdminChangeConfiguration : IEntityTypeConfiguration<AdminChange>
{
    public void Configure(EntityTypeBuilder<AdminChange> builder)
    {
        builder.ToTable("admin_changes", t =>
        {
            t.HasCheckConstraint("ck_admin_changes_before_bound", "before IS NULL OR octet_length(before::text) <= 65536");
            t.HasCheckConstraint("ck_admin_changes_after_bound", "octet_length(after::text) <= 65536");
        });
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();
        builder.Property(r => r.ResourceKind).HasMaxLength(16);
        builder.Property(r => r.Action).HasMaxLength(16);
        builder.Property(r => r.Actor).HasMaxLength(CurrentActor.MaxLength);
        builder.Property(r => r.Before).HasColumnType("jsonb");
        builder.Property(r => r.After).HasColumnType("jsonb");
        builder.HasIndex(r => new { r.DealershipId, r.AtUtc, r.Id });
        builder.HasOne<Dealership>().WithMany().HasForeignKey(r => r.DealershipId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class RequirementPolicyVersionConfiguration : IEntityTypeConfiguration<RequirementPolicyVersion>
{
    public void Configure(EntityTypeBuilder<RequirementPolicyVersion> builder)
    {
        builder.ToTable("requirement_policy_versions", t => t.HasCheckConstraint("ck_requirement_policy_versions_positive", "version > 0"));
        builder.HasKey(r => new { r.DealershipId, r.Version });
        builder.HasOne<Dealership>().WithMany().HasForeignKey(r => r.DealershipId).OnDelete(DeleteBehavior.Cascade);
    }
}

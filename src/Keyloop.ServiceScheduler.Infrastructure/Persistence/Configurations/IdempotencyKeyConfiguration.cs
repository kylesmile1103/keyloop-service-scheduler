using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class IdempotencyKeyConfiguration : IEntityTypeConfiguration<IdempotencyKey>
{
    public void Configure(EntityTypeBuilder<IdempotencyKey> builder)
    {
        builder.ToTable("idempotency_keys");

        // Named by the snake-case convention as pk_idempotency_keys, which PostgresErrorClassifier matches on 23505.
        builder.HasKey(k => k.Key);
        builder.Property(k => k.Key).HasMaxLength(IdempotencyKey.MaxKeyLength).ValueGeneratedNever();
        builder.Property(k => k.RequestFingerprint).HasMaxLength(64);
        builder.Property(k => k.ResponseBody).HasColumnType("jsonb");
        builder.HasIndex(k => k.ExpiresAtUtc);
    }
}

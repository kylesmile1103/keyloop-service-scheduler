using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;

internal sealed class AppointmentConfiguration : IEntityTypeConfiguration<Appointment>
{
    /// <summary>Shadow property for the stored generated <c>tstzrange</c> that the exclusion constraints index.</summary>
    public const string TimeRangeProperty = "TimeRange";

    public void Configure(EntityTypeBuilder<Appointment> builder)
    {
        builder.ToTable("appointments", t =>
        {
            t.HasCheckConstraint("ck_appointments_end_after_start", "end_utc > start_utc");
            t.HasCheckConstraint("ck_appointments_vin_format", "vehicle_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'");
        });
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();

        builder.ComplexProperty(a => a.Slot, slot =>
        {
            slot.Property(s => s.StartUtc).HasColumnName("start_utc");
            slot.Property(s => s.EndUtc).HasColumnName("end_utc");
        });
        builder.ComplexProperty(a => a.Customer, customer =>
        {
            customer.Property(c => c.Name).HasColumnName("customer_name").HasMaxLength(120);
            customer.Property(c => c.Email).HasColumnName("customer_email").HasMaxLength(254);
            customer.Property(c => c.Phone).HasColumnName("customer_phone").HasMaxLength(40);
        });
        builder.ComplexProperty(a => a.Vehicle, vehicle =>
        {
            vehicle.Property(v => v.Vin).HasColumnName("vehicle_vin").HasMaxLength(17).HasConversion(vin => vin.Value, value => Vin.Create(value));
            vehicle.Property(v => v.Registration).HasColumnName("vehicle_registration").HasMaxLength(16);
            vehicle.Property(v => v.Make).HasColumnName("vehicle_make").HasMaxLength(60);
            vehicle.Property(v => v.Model).HasColumnName("vehicle_model").HasMaxLength(60);
        });

        builder.ComplexProperty(a => a.VehicleProfile, profile =>
        {
            profile.Property(p => p.Powertrain).HasColumnName("vehicle_powertrain").HasConversion<string>().HasMaxLength(32);
            profile.Property(p => p.Manufacturer).HasColumnName("vehicle_manufacturer").HasMaxLength(32);
            profile.Property(p => p.VehicleClass).HasColumnName("vehicle_class").HasConversion<string>().HasMaxLength(32);
            profile.Property(p => p.Provenance).HasColumnName("vehicle_profile_provenance").HasColumnType("jsonb")
                .HasConversion(p => VehicleJson.ProvenanceToJson(p), p => VehicleJson.ProvenanceFromJson(p));
        });
        builder.Property(a => a.AllocationDecision).HasColumnType("jsonb")
            .HasConversion(p => VehicleJson.DecisionToJson(p!), p => VehicleJson.DecisionFromJson(p));

        builder.Property(a => a.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(a => a.Notes).HasMaxLength(Appointment.MaxNotesLength);
        builder.Property(a => a.CancellationReason).HasMaxLength(Appointment.MaxCancellationReasonLength);

        builder.Property<NpgsqlRange<DateTime>>(TimeRangeProperty)
            .HasColumnName("time_range")
            .HasColumnType("tstzrange")
            .HasComputedColumnSql("tstzrange(start_utc, end_utc, '[)')", stored: true);

        builder.Property(a => a.RecordedRequirements).HasColumnType("jsonb")
            .HasConversion(v => VehicleJson.RequirementsToJson(v!), v => VehicleJson.RequirementsFromJson(v))
            .Metadata.SetValueComparer(new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<RecordedRequirements?>(
                (a, b) => a == null ? b == null : b != null && VehicleJson.RequirementsToJson(a) == VehicleJson.RequirementsToJson(b),
                v => v == null ? 0 : VehicleJson.RequirementsToJson(v).GetHashCode(),
                v => v == null ? null : VehicleJson.RequirementsFromJson(VehicleJson.RequirementsToJson(v))));
        // Maps to PostgreSQL's xmin system column for optimistic concurrency.
        builder.Property(a => a.RowVersion).IsRowVersion();

        // The (dealership_id, start_utc) day-query index is created in the migration's SQL next to the exclusion constraints:
        // EF Core 10 cannot declare an index over a complex-type property.

        // Other aggregates are referenced by id only (no navigations). Restrict: appointments are history, never cascaded away.
        builder.HasOne<Dealership>().WithMany().HasForeignKey(a => a.DealershipId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ServiceType>().WithMany().HasForeignKey(a => a.ServiceTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ServiceBay>().WithMany().HasForeignKey(a => a.BayId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Technician>().WithMany().HasForeignKey(a => a.TechnicianId).OnDelete(DeleteBehavior.Restrict);

        builder.Ignore(a => a.DomainEvents);
        builder.Ignore(a => a.IsActive);
    }
}

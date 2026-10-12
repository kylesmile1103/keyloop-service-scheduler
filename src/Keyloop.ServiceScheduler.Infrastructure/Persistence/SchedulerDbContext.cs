using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Configurations;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

public sealed class SchedulerDbContext(DbContextOptions<SchedulerDbContext> options) : DbContext(options)
{
    /// <summary>
    /// The audit interceptor this context was configured with (null without one): the instance holding this context's pending and
    /// in-doubt domain events, so a caller that settles an in-doubt commit reaches the right one whatever the DI lifetimes.
    /// </summary>
    public DomainEventInterceptor? DomainEvents { get; } =
        options.FindExtension<CoreOptionsExtension>()?.Interceptors?.OfType<DomainEventInterceptor>().SingleOrDefault();

    public DbSet<Dealership> Dealerships => Set<Dealership>();

    public DbSet<ServiceBay> ServiceBays => Set<ServiceBay>();

    public DbSet<Technician> Technicians => Set<Technician>();

    public DbSet<ServiceType> ServiceTypes => Set<ServiceType>();

    public DbSet<Appointment> Appointments => Set<Appointment>();

    public DbSet<AppointmentHistoryEntry> AppointmentHistory => Set<AppointmentHistoryEntry>();

    public DbSet<IdempotencyKey> IdempotencyKeys => Set<IdempotencyKey>();

    public DbSet<NotificationOutboxEntry> NotificationOutbox => Set<NotificationOutboxEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // btree_gist lets the exclusion constraints' GiST index combine uuid equality with range overlap (SYSTEM_DESIGN §7.3).
        modelBuilder.HasPostgresExtension("btree_gist");

        // Listed explicitly rather than ApplyConfigurationsFromAssembly: no assembly scanning (ADR-016).
        modelBuilder.ApplyConfiguration(new DealershipConfiguration());
        modelBuilder.ApplyConfiguration(new ServiceBayConfiguration());
        modelBuilder.ApplyConfiguration(new TechnicianConfiguration());
        modelBuilder.ApplyConfiguration(new ServiceTypeConfiguration());
        modelBuilder.ApplyConfiguration(new AppointmentConfiguration());
        modelBuilder.ApplyConfiguration(new AppointmentHistoryConfiguration());
        modelBuilder.ApplyConfiguration(new IdempotencyKeyConfiguration());
        modelBuilder.ApplyConfiguration(new NotificationOutboxConfiguration());
    }
}

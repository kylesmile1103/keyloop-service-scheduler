using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class SeedingTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Reference_seed_is_idempotent()
    {
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        var first = await CountsAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        var second = await CountsAsync();

        first.ShouldBe((2, 9, 9, 10, 14));
        second.ShouldBe(first);
    }

    [Fact]
    public async Task Reference_seed_round_trips_hours_capabilities_and_deterministic_ids()
    {
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));

        await _factory.WithDbAsync(async db =>
        {
            var reading = await db.Dealerships.AsNoTracking().SingleAsync(d => d.Id == ReferenceDataSeed.ReadingDealershipId, Ct);
            reading.Name.ShouldBe("Keyloop Motors Reading");
            reading.TimeZoneId.ShouldBe("Europe/London");
            reading.Hours.ForDay(DayOfWeek.Monday).ShouldBe(new DayOperatingHours(DayOfWeek.Monday, new TimeOnly(8, 0), new TimeOnly(18, 0)));
            reading.Hours.ForDay(DayOfWeek.Saturday).ShouldBe(new DayOperatingHours(DayOfWeek.Saturday, new TimeOnly(8, 0), new TimeOnly(13, 0)));
            reading.Hours.ForDay(DayOfWeek.Sunday).IsClosed.ShouldBeTrue();

            var munich = await db.Dealerships.AsNoTracking().SingleAsync(d => d.Id == ReferenceDataSeed.MunichDealershipId, Ct);
            munich.Name.ShouldBe("Keyloop Autohaus München");
            munich.ResolveOperatingWindow(TestData.BookingDay).ShouldBe(new OperatingWindow(
                new DateTime(2026, 10, 13, 5, 30, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 16, 30, 0, DateTimeKind.Utc)));
            munich.Hours.ForDay(DayOfWeek.Saturday).IsClosed.ShouldBeTrue();

            var heavyDuty = await db.ServiceBays.AsNoTracking().SingleAsync(b => b.Name == "Bay 3 - Heavy duty", Ct);
            heavyDuty.DealershipId.ShouldBe(ReferenceDataSeed.ReadingDealershipId);
            heavyDuty.Capabilities.ShouldBe([BayCapability.HeavyDutyLift, BayCapability.StandardLift], ignoreOrder: true);

            var ben = await db.Technicians.AsNoTracking().SingleAsync(t => t.EmployeeNumber == "T-1002", Ct);
            ben.Name.ShouldBe("Ben Okafor");
            ben.Certifications.ShouldBe([Certification.GeneralService, Certification.HighVoltageElectrical, Certification.Diagnostics], ignoreOrder: true);

            var evFault = await db.ServiceTypes.AsNoTracking().SingleAsync(s => s.Code == "EV-CHARGING-FAULT", Ct);
            evFault.Duration.Minutes.ShouldBe(90);
            evFault.RequiredBayCapabilities.ShouldBe([BayCapability.EvHighVoltage]);
            evFault.RequiredCertifications.ShouldBe([Certification.HighVoltageElectrical, Certification.Diagnostics], ignoreOrder: true);

            // Every Reading service type is bookable somewhere at Reading.
            var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == ReferenceDataSeed.ReadingDealershipId).ToListAsync(Ct);
            var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == ReferenceDataSeed.ReadingDealershipId).ToListAsync(Ct);
            foreach (var serviceType in await db.ServiceTypes.AsNoTracking().ToListAsync(Ct))
            {
                bays.ShouldContain(b => b.Supports(serviceType), serviceType.Code);
                technicians.ShouldContain(t => t.IsCertifiedFor(serviceType), serviceType.Code);
            }
        });
    }

    [Fact]
    public async Task Demo_seeder_populates_upcoming_week_without_overlaps()
    {
        var created = await _factory.WithDbAsync(async db =>
        {
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
            return await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct);
        });

        await _factory.WithDbAsync(async db =>
        {
            var reading = await db.Dealerships.AsNoTracking().SingleAsync(d => d.Id == ReferenceDataSeed.ReadingDealershipId, Ct);
            var appointments = await db.Appointments.AsNoTracking().ToListAsync(Ct);
            appointments.Count.ShouldBe(created);
            appointments.ShouldAllBe(a => a.DealershipId == ReferenceDataSeed.ReadingDealershipId && a.Status == AppointmentStatus.Confirmed);
            appointments.ShouldAllBe(a => a.Slot.StartUtc >= TestData.Now, "nothing is seeded in the past");

            // Every open local date of the coming week gets 4-6 appointments; the closed Sunday gets none.
            var today = LocalTimeConverter.ToLocalDate(TestData.Now, reading.TimeZone);
            var byDate = appointments.GroupBy(a => LocalTimeConverter.ToLocalDate(a.Slot.StartUtc, reading.TimeZone)).ToDictionary(g => g.Key, g => g.Count());
            byDate.Keys.ShouldAllBe(d => d >= today && d < today.AddDays(7));
            for (var date = today; date < today.AddDays(7); date = date.AddDays(1))
            {
                var window = reading.ResolveOperatingWindow(date);
                if (window is null)
                {
                    byDate.ContainsKey(date).ShouldBeFalse(date.ToString("O", System.Globalization.CultureInfo.InvariantCulture));
                }
                else
                {
                    byDate.GetValueOrDefault(date).ShouldBeInRange(4, 6, date.ToString("O", System.Globalization.CultureInfo.InvariantCulture));
                    appointments.Where(a => LocalTimeConverter.ToLocalDate(a.Slot.StartUtc, reading.TimeZone) == date)
                        .ShouldAllBe(a => window.Value.Contains(a.Slot));
                }
            }

            // The invariant the exclusion constraints guarantee, asserted independently.
            var active = appointments.Where(a => a.IsActive).ToList();
            var overlaps = active.SelectMany(a => active.Where(b => b.Id != a.Id && a.Slot.Overlaps(b.Slot) && (a.BayId == b.BayId || a.TechnicianId == b.TechnicianId)));
            overlaps.ShouldBeEmpty();

            // Each appointment's resources are qualified, and seeding went through the aggregate (one Booked history row each).
            var bays = await db.ServiceBays.AsNoTracking().ToDictionaryAsync(b => b.Id, Ct);
            var technicians = await db.Technicians.AsNoTracking().ToDictionaryAsync(t => t.Id, Ct);
            var serviceTypes = await db.ServiceTypes.AsNoTracking().ToDictionaryAsync(s => s.Id, Ct);
            appointments.ShouldAllBe(a => bays[a.BayId].Supports(serviceTypes[a.ServiceTypeId]) && technicians[a.TechnicianId].IsCertifiedFor(serviceTypes[a.ServiceTypeId]));
            var history = await db.AppointmentHistory.AsNoTracking().ToListAsync(Ct);
            history.Count.ShouldBe(created);
            history.ShouldAllBe(h => h.EventType == "Booked" && h.Actor == "system");
        });
    }

    [Fact]
    public async Task Demo_seeder_is_idempotent()
    {
        var (first, second) = await _factory.WithDbAsync(async db =>
        {
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
            var created = await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct);
            return (created, await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct));
        });

        first.ShouldBeGreaterThan(0);
        second.ShouldBe(0);
        (await _factory.WithDbAsync(db => db.Appointments.CountAsync(Ct))).ShouldBe(first);

        // A fresh context (as on the next application start) sees the same state and also adds nothing.
        (await _factory.WithDbAsync(db => DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct))).ShouldBe(0);
    }

    [Fact]
    public async Task Demo_seeder_rerun_does_not_collide_with_cancelled_rows()
    {
        await _factory.WithDbAsync(async db =>
        {
            await ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct);
            await DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct);
        });
        var cancelled = await _factory.WithDbAsync(async db =>
        {
            var reading = await db.Dealerships.AsNoTracking().SingleAsync(d => d.Id == ReferenceDataSeed.ReadingDealershipId, Ct);
            var window = reading.ResolveOperatingWindow(TestData.BookingDay)!.Value;
            var onTuesday = await db.Appointments.Where(a => a.Slot.StartUtc >= window.StartUtc && a.Slot.StartUtc < window.EndUtc).ToListAsync(Ct);
            onTuesday.ForEach(a => a.Cancel("Workshop closed for training", TestData.Now));
            await db.SaveChangesAsync(Ct);
            return onTuesday.Count;
        });

        // Tuesday now has no active appointment, so the seeder revisits it; the pattern's deterministic ids already belong to the
        // cancelled rows, so it must skip them rather than fail with a primary-key violation.
        var created = await _factory.WithDbAsync(db => DemoAppointmentSeeder.EnsureUpcomingWeekAsync(db, _factory.Clock, Ct));

        cancelled.ShouldBeInRange(4, 6);
        created.ShouldBe(0);
    }

    [Fact]
    public async Task Startup_seeds_reference_and_demo_data_when_enabled()
    {
        await using var seeded = _factory.WithWebHostBuilder(builder => builder.UseSetting("Database:SeedDemoData", "true"));
        _ = seeded.Services;

        await using var scope = seeded.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        (await db.Dealerships.CountAsync(Ct)).ShouldBe(2);
        (await db.Appointments.CountAsync(Ct)).ShouldBeGreaterThan(0);
    }

    private Task<(int Dealerships, int Bays, int Technicians, int ServiceTypes, int HoursRows)> CountsAsync() =>
        _factory.WithDbAsync(async db => (
            await db.Dealerships.CountAsync(Ct),
            await db.ServiceBays.CountAsync(Ct),
            await db.Technicians.CountAsync(Ct),
            await db.ServiceTypes.CountAsync(Ct),
            await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM dealership_operating_hours""").SingleAsync(Ct)));
}

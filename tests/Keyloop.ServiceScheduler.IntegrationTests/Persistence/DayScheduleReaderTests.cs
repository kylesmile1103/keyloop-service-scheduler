using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class DayScheduleReaderTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;
    private OperatingWindow _window;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
        _window = _workshop.Dealership.ResolveOperatingWindow(TestData.BookingDay)!.Value;
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Reads_the_dealership_resources_and_appointments_overlapping_the_window()
    {
        var (early, late, cancelled) = await SeedDayAsync();

        var snapshot = await ReadAsync(_workshop.Dealership.Id, activeOnly: false);

        snapshot.ShouldNotBeNull();
        snapshot.Dealership.Id.ShouldBe(_workshop.Dealership.Id);
        snapshot.Dealership.Hours.ForDay(DayOfWeek.Tuesday).OpensAt.ShouldBe(new TimeOnly(8, 0));
        snapshot.Bays.Select(b => b.Name).ShouldBe(["Bay 1", "Bay 2", "Bay 9 - Inactive"]);
        snapshot.Technicians.Select(t => t.Name).ShouldBe(["Amelia Clarke", "Ben Okafor"]);
        snapshot.Appointments.Select(a => a.Id).ShouldBe([early.Id, cancelled.Id, late.Id]);

        var row = snapshot.Appointments[0];
        row.BayId.ShouldBe(_workshop.Bay1.Id);
        row.TechnicianId.ShouldBe(_workshop.Technician1.Id);
        row.ServiceTypeId.ShouldBe(_workshop.Interim.Id);
        row.Slot.ShouldBe(TimeSlot.Create(TestData.LondonTime(8), TestData.LondonTime(9)));
        row.Slot.StartUtc.Kind.ShouldBe(DateTimeKind.Utc);
        row.Status.ShouldBe(AppointmentStatus.Confirmed);
        row.Vin.ShouldBe("WVWZZZ1KZAW123456");
        row.Registration.ShouldBe("AB12 CDE");
        row.CustomerName.ShouldBe("Customer 1");
    }

    [Fact]
    public async Task Active_only_drops_terminal_statuses()
    {
        var (early, late, _) = await SeedDayAsync();

        var snapshot = await ReadAsync(_workshop.Dealership.Id, activeOnly: true);

        snapshot.ShouldNotBeNull().Appointments.Select(a => a.Id).ShouldBe([early.Id, late.Id]);
    }

    [Fact]
    public async Task Reads_the_day_of_an_already_loaded_dealership_without_reading_it_again()
    {
        var (early, late, cancelled) = await SeedDayAsync();
        var byId = (await ReadAsync(_workshop.Dealership.Id, activeOnly: false)).ShouldNotBeNull();

        await using var scope = _factory.Services.CreateAsyncScope();
        var snapshot = await scope.ServiceProvider.GetRequiredService<DayScheduleReader>().ReadAsync(_workshop.Dealership, _window, activeOnly: false, Ct);

        snapshot.Dealership.ShouldBeSameAs(_workshop.Dealership);
        snapshot.Bays.Select(b => b.Id).ShouldBe(byId.Bays.Select(b => b.Id));
        snapshot.Technicians.Select(t => t.Id).ShouldBe(byId.Technicians.Select(t => t.Id));
        snapshot.Appointments.ShouldBe(byId.Appointments);
        snapshot.Appointments.Select(a => a.Id).ShouldBe([early.Id, cancelled.Id, late.Id]);
    }

    [Fact]
    public async Task Unknown_dealership_reads_as_null()
    {
        (await ReadAsync(Guid.NewGuid(), activeOnly: true)).ShouldBeNull();
    }

    [Fact]
    public async Task Resources_are_every_bay_and_technician_of_the_dealership_by_name_and_none_for_an_unknown_one()
    {
        await SeedDayAsync();

        await using var scope = _factory.Services.CreateAsyncScope();
        var reader = scope.ServiceProvider.GetRequiredService<DayScheduleReader>();
        var (bays, technicians) = await reader.ReadResourcesAsync(_workshop.Dealership.Id, Ct);
        var unknown = await reader.ReadResourcesAsync(Guid.NewGuid(), Ct);

        bays.Select(b => (b.Name, b.IsActive)).ShouldBe([("Bay 1", true), ("Bay 2", true), ("Bay 9 - Inactive", false)]);
        technicians.Select(t => t.Name).ShouldBe(["Amelia Clarke", "Ben Okafor"]);
        unknown.Bays.ShouldBeEmpty();
        unknown.Technicians.ShouldBeEmpty();
    }

    [Fact]
    public async Task Load_counts_active_appointments_per_bay_and_technician()
    {
        await SeedDayAsync();

        await using var scope = _factory.Services.CreateAsyncScope();
        var counts = await scope.ServiceProvider.GetRequiredService<DayScheduleReader>().LoadCountsAsync(_workshop.Dealership.Id, _window, Ct);

        counts.ShouldBe(new Dictionary<Guid, int>
        {
            [_workshop.Bay1.Id] = 1,
            [_workshop.Bay2.Id] = 1,
            [_workshop.Technician1.Id] = 1,
            [_workshop.Technician2.Id] = 1,
        }, ignoreOrder: true);
    }

    private async Task<(Appointment Early, Appointment Late, Appointment Cancelled)> SeedDayAsync()
    {
        var early = _workshop.Book(TestData.LondonTime(8));
        var cancelled = _workshop.Book(TestData.LondonTime(10), customer: 2);
        cancelled.Cancel("Customer rescheduled", TestData.Now);
        var late = _workshop.Book(TestData.LondonTime(17), _workshop.Bay2, _workshop.Technician2, customer: 3);
        var nextDay = TestData.NewAppointment(
            _workshop.Dealership, _workshop.Interim, _workshop.Bay1, _workshop.Technician1, TestData.LondonTime(8).AddDays(1), customer: 4);
        var inactiveBay = ServiceBay.Create(Guid.NewGuid(), _workshop.Dealership.Id, "Bay 9 - Inactive", [BayCapability.StandardLift], isActive: false);
        var otherDealership = TestData.NewDealership("Elsewhere Motors");
        var otherBay = TestData.NewBay(otherDealership.Id, "Bay 0", BayCapability.StandardLift);

        await _factory.WithDbAsync(async db =>
        {
            db.AddRange(early, cancelled, late, nextDay, inactiveBay, otherDealership, otherBay);
            await db.SaveChangesAsync(Ct);
        });
        return (early, late, cancelled);
    }

    private async Task<DayScheduleReader.DaySnapshot?> ReadAsync(Guid dealershipId, bool activeOnly)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<DayScheduleReader>().ReadAsync(dealershipId, _window, activeOnly, Ct);
    }
}

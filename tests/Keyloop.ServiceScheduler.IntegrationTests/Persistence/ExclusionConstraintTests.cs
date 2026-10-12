using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

/// <summary>
/// The overlap invariant is enforced by the database itself (ARCHITECTURE §7.3 layer 1): these writes bypass the booking handler
/// and its advisory lock, exactly like an out-of-band writer would.
/// </summary>
public sealed class ExclusionConstraintTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private TestData.Workshop _workshop = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _workshop = await _factory.WithDbAsync(TestData.WorkshopAsync);
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Direct_sql_overlapping_bay_insert_is_rejected_with_23P01()
    {
        await BookAsync(TestData.LondonTime(9), _workshop.Bay1, _workshop.Technician1);

        // Same bay, a different technician, overlapping by 30 minutes.
        var ex = await Should.ThrowAsync<PostgresException>(() =>
            InsertRawAsync(TestData.LondonTime(9, 30), TestData.LondonTime(10, 30), _workshop.Bay1.Id, _workshop.Technician2.Id));

        ex.SqlState.ShouldBe(PostgresErrorCodes.ExclusionViolation);
        ex.ConstraintName.ShouldBe(PostgresErrorClassifier.BayConstraint);
        PostgresErrorClassifier.Classify(ex).ShouldBe(PostgresFailure.BayOverlap);
    }

    [Fact]
    public async Task Technician_overlap_rejected()
    {
        await BookAsync(TestData.LondonTime(9), _workshop.Bay1, _workshop.Technician1);

        // A different bay, the same technician, starting inside the existing slot.
        var ex = await Should.ThrowAsync<PostgresException>(() =>
            InsertRawAsync(TestData.LondonTime(9, 45), TestData.LondonTime(10, 45), _workshop.Bay2.Id, _workshop.Technician1.Id));

        ex.SqlState.ShouldBe(PostgresErrorCodes.ExclusionViolation);
        ex.ConstraintName.ShouldBe(PostgresErrorClassifier.TechnicianConstraint);
        PostgresErrorClassifier.Classify(ex).ShouldBe(PostgresFailure.TechnicianOverlap);
    }

    [Fact]
    public async Task Cancelled_row_does_not_block()
    {
        var booked = await BookAsync(TestData.LondonTime(9), _workshop.Bay1, _workshop.Technician1);
        await _factory.WithDbAsync(async db =>
        {
            var appointment = await db.Appointments.SingleAsync(a => a.Id == booked.Id, Ct);
            appointment.Cancel("Customer rescheduled", TestData.Now);
            await db.SaveChangesAsync(Ct);
        });

        // The exact same bay, technician and slot are free again ...
        await InsertRawAsync(TestData.LondonTime(9), TestData.LondonTime(10), _workshop.Bay1.Id, _workshop.Technician1.Id);

        // ... and a terminal-status row may overlap an active one, because the constraints are partial.
        await InsertRawAsync(TestData.LondonTime(9), TestData.LondonTime(10), _workshop.Bay1.Id, _workshop.Technician1.Id, status: "NoShow");

        (await CountAsync()).ShouldBe(3);
    }

    [Fact]
    public async Task Adjacent_rows_do_not_conflict()
    {
        await BookAsync(TestData.LondonTime(9), _workshop.Bay1, _workshop.Technician1);

        // Half-open ranges: [09:00, 10:00) and [10:00, 11:00) touch but do not overlap, on both the bay and the technician.
        await InsertRawAsync(TestData.LondonTime(10), TestData.LondonTime(11), _workshop.Bay1.Id, _workshop.Technician1.Id);
        await InsertRawAsync(TestData.LondonTime(8), TestData.LondonTime(9), _workshop.Bay1.Id, _workshop.Technician1.Id);

        (await CountAsync()).ShouldBe(3);
    }

    [Fact]
    public async Task Overlap_saved_through_ef_is_classified_through_the_wrapping_exception()
    {
        await BookAsync(TestData.LondonTime(9), _workshop.Bay1, _workshop.Technician1);

        var ex = await Should.ThrowAsync<DbUpdateException>(() => BookAsync(TestData.LondonTime(9, 15), _workshop.Bay1, _workshop.Technician2));

        ex.InnerException.ShouldBeOfType<PostgresException>().SqlState.ShouldBe(PostgresErrorCodes.ExclusionViolation);
        PostgresErrorClassifier.Classify(ex).ShouldBe(PostgresFailure.BayOverlap);
    }

    private Task<Appointment> BookAsync(DateTime startUtc, ServiceBay bay, Technician technician) =>
        _factory.WithDbAsync(async db =>
        {
            var appointment = _workshop.Book(startUtc, bay, technician);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
            return appointment;
        });

    private Task<int> CountAsync() => _factory.WithDbAsync(db => db.Appointments.CountAsync(Ct));

    private Task InsertRawAsync(DateTime startUtc, DateTime endUtc, Guid bayId, Guid technicianId, string status = "Confirmed") =>
        _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO appointments (id, dealership_id, service_type_id, bay_id, technician_id, start_utc, end_utc, status,
                customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model,
                created_at_utc, updated_at_utc)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7},
                'Out Of Band', 'oob@example.com', '+44 7700 900000', 'WVWZZZ1KZAW123456', 'AB12 CDE', 'Volkswagen', 'Golf',
                {8}, {8})
            """,
            [Guid.CreateVersion7(), _workshop.Dealership.Id, _workshop.Interim.Id, bayId, technicianId, startUtc, endUtc, status, TestData.Now],
            Ct));
}

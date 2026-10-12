using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

/// <summary>
/// PostgreSQL's <c>xmin</c> is the appointment's optimistic concurrency token (SYSTEM_DESIGN §7.3 layer 3, mapped with
/// <c>IsRowVersion()</c>): a transition saved from a stale read must fail rather than overwrite a newer one (first writer wins).
/// </summary>
public sealed class AppointmentConcurrencyTokenTests(PostgresFixture pg) : IAsyncLifetime
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
    public async Task Saving_a_transition_advances_the_row_version_to_the_new_xmin()
    {
        var appointment = await SaveBookedAsync();
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var loaded = await db.Appointments.SingleAsync(a => a.Id == appointment.Id, Ct);
        var before = loaded.RowVersion;
        (await XminAsync(db, appointment.Id)).ShouldBe(before, "the token is the row's xmin");

        loaded.CheckIn(TestData.Now);
        await db.SaveChangesAsync(Ct);

        loaded.RowVersion.ShouldNotBe(before, "the UPDATE reads the new token back");
        (await XminAsync(db, appointment.Id)).ShouldBe(loaded.RowVersion);
    }

    [Fact]
    public async Task Stale_update_of_an_appointment_throws_DbUpdateConcurrencyException()
    {
        var appointment = await SaveBookedAsync();
        await using var firstScope = _factory.Services.CreateAsyncScope();
        await using var secondScope = _factory.Services.CreateAsyncScope();
        var firstDb = firstScope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var secondDb = secondScope.ServiceProvider.GetRequiredService<SchedulerDbContext>();
        var first = await firstDb.Appointments.SingleAsync(a => a.Id == appointment.Id, Ct);
        var second = await secondDb.Appointments.SingleAsync(a => a.Id == appointment.Id, Ct);
        second.RowVersion.ShouldBe(first.RowVersion, "both read the same version");

        first.CheckIn(TestData.Now);
        await firstDb.SaveChangesAsync(Ct);
        second.Cancel("Customer called to reschedule.", TestData.Now); // legal from the Confirmed state the second context read

        var conflict = await Should.ThrowAsync<DbUpdateConcurrencyException>(() => secondDb.SaveChangesAsync(Ct));

        conflict.Entries.ShouldHaveSingleItem().Entity.ShouldBeSameAs(second);
        await _factory.WithDbAsync(async db =>
        {
            var row = await db.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointment.Id, Ct);
            (row.Status, row.CancellationReason).ShouldBe((AppointmentStatus.CheckedIn, null), "the first writer's transition stands");
            (await db.AppointmentHistory.OrderBy(h => h.OccurredAtUtc).ThenBy(h => h.EventType).Select(h => h.EventType).ToListAsync(Ct))
                .ShouldBe(["Booked", "CheckedIn"], ignoreOrder: true, customMessage: "the stale writer's audit row was not saved");
        });
    }

    private async Task<Appointment> SaveBookedAsync()
    {
        var appointment = _workshop.Book(TestData.LondonTime(11));
        await _factory.WithDbAsync(async db =>
        {
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync(Ct);
        });
        return appointment;
    }

    /// <summary>The row's <c>xmin</c> as PostgreSQL reports it (an <c>xid</c>, read as text so no driver mapping is involved).</summary>
    private static async Task<uint> XminAsync(SchedulerDbContext db, Guid appointmentId) =>
        checked((uint)await db.Database.SqlQuery<long>($"""SELECT xmin::text::bigint AS "Value" FROM appointments WHERE id = {appointmentId}""").SingleAsync(Ct));
}

using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Persistence;

public sealed class VehicleCompetencePersistenceTests(PostgresFixture pg)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Upgrade_maps_existing_HV_certification_without_confirming_and_backfills_Unknown()
    {
        var connectionString = await pg.CreateEmptyDatabaseAsync("vehicle_competence_upgrade", Ct);
        await using var db = new SchedulerDbContext(new DbContextOptionsBuilder<SchedulerDbContext>()
            .UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options);
        await db.GetService<IMigrator>().MigrateAsync("20261012120836_WidenAuditActor", Ct);
        var site = Guid.NewGuid();
        var bay = Guid.NewGuid();
        var hv = Guid.NewGuid();
        var nonHv = Guid.NewGuid();
        var service = Guid.NewGuid();
        var appointment = Guid.NewGuid();
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO dealerships(id,name,time_zone_id,created_at_utc) VALUES ({site},'Legacy','Europe/London',{TestData.Now});
            INSERT INTO service_bays(id,dealership_id,name,capabilities,is_active) VALUES ({bay},{site},'Bay',ARRAY['EvHighVoltage'],true);
            INSERT INTO technicians(id,dealership_id,name,employee_number,certifications,is_active) VALUES
              ({hv},{site},'HV','HV',ARRAY['HighVoltageElectrical'],true),
              ({nonHv},{site},'ICE','ICE',ARRAY['GeneralService'],true);
            INSERT INTO service_types(id,code,name,duration_minutes,required_bay_capabilities,required_certifications) VALUES
              ({service},'EV-BATTERY-CHECK','EV',60,ARRAY['EvHighVoltage'],ARRAY['HighVoltageElectrical']);
            INSERT INTO appointments(id,dealership_id,service_type_id,bay_id,technician_id,start_utc,end_utc,status,
              customer_name,customer_email,customer_phone,vehicle_vin,vehicle_registration,vehicle_make,vehicle_model,created_at_utc,updated_at_utc) VALUES
              ({appointment},{site},{service},{bay},{hv},{TestData.LondonTime(10)},{TestData.LondonTime(11)},'Confirmed',
              'Legacy','legacy@example.com','123','WVWZZZ1KZAW123456','AB12 CDE','Volkswagen','Golf',{TestData.Now},{TestData.Now});
            """, Ct);
        var before = await Exclusions(db);
        await db.Database.MigrateAsync(Ct);
        (await Exclusions(db)).ShouldBe(before);
        var technician = await db.Technicians.SingleAsync(t => t.Id == hv, Ct);
        (technician.HvLevel, technician.HvLevelConfirmed, technician.HvLevelValidUntil).ShouldBe((3, false, null));
        (await db.Technicians.SingleAsync(t => t.Id == nonHv, Ct)).HvLevel.ShouldBe(0);
        var row = await db.Appointments.SingleAsync(a => a.Id == appointment, Ct);
        row.VehicleProfile.ShouldBe(VehicleProfile.Unknown);
        row.AllocationDecision.ShouldBeNull();
        var requirements = RequirementResolver.Resolve(await db.ServiceTypes.SingleAsync(Ct), VehicleProfile.Unknown, RequirementRule.DefaultPolicy(site));
        technician.Satisfies(requirements, TestData.BookingDay).ShouldBeTrue();
        var invalid = await Should.ThrowAsync<PostgresException>(() => db.Database.ExecuteSqlAsync($"UPDATE technicians SET hv_level = 5 WHERE id = {hv}", Ct));
        invalid.ConstraintName.ShouldBe("ck_technicians_hv_level");
        await ReferenceDataSeed.EnsureSeededAsync(db, TestData.Clock(), Ct);
        db.ChangeTracker.Clear();
        (await db.Technicians.SingleAsync(t => t.Id == hv, Ct)).HvLevelConfirmed.ShouldBeFalse();
        (await db.RequirementRules.CountAsync(Ct)).ShouldBe(7);
    }

    private static Task<List<string>> Exclusions(SchedulerDbContext db) => db.Database.SqlQuery<string>($"""
        SELECT pg_get_constraintdef(oid) AS "Value" FROM pg_constraint WHERE conrelid='appointments'::regclass AND contype='x' ORDER BY conname
        """).ToListAsync(Ct);
}

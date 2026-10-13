using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// Verifies that technician HV level violations are counted and logged critically.
/// </summary>
public sealed class AllocationSafetyTests
{
    private static readonly Guid Site = Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e");
    private static readonly Guid AppointmentId = Guid.Parse("01900000-0000-7000-8000-000000000001");
    private static readonly DateOnly Day = new(2026, 10, 13);
    private static readonly JobRequirements Requirements = new(new HashSet<BayCapability>(), new HashSet<Certification>(), 3, 7,
        [RequirementResolver.LegacyHvComponentRule, "hv-components"]);

    [Fact]
    public void A_technician_below_the_minimum_on_the_local_date_is_counted_and_logged_critically()
    {
        // One test owns the instrument: it is process-wide and no other unit test touches it.
        var measurements = new List<(long Value, int Tags)>();
        using var listener = new MeterListener
        {
            InstrumentPublished = (instrument, l) =>
            {
                if (ReferenceEquals(instrument.Meter, SchedulerTelemetry.Meter) && instrument.Name == "scheduler.allocation.below_hv_minimum")
                {
                    l.EnableMeasurementEvents(instrument);
                }
            },
        };
        listener.SetMeasurementEventCallback<long>((_, value, tags, _) => measurements.Add((value, tags.Length)));
        listener.Start();

        // Level 3 that lapsed the day before the appointment's local date: effective level 0.
        var expired = Technician.Create(Guid.Parse("bd559b63-ceea-83dd-9a48-f2bc7a515dcd"), Site, "Amelia Clarke", "T-1001", [],
            hvLevel: 3, hvLevelValidUntil: Day.AddDays(-1), hvLevelConfirmed: true);
        var log = new CapturingLogger<AllocationSafetyTests>();

        AllocationSafety.MeetsHvMinimum(expired, Requirements, Day, AppointmentId, log).ShouldBeFalse();

        measurements.ShouldBe([(1L, 0)]);
        var entry = log.Entries.ShouldHaveSingleItem();
        (entry.EventId.Id, entry.EventId.Name, entry.Level).ShouldBe((1020, "AllocationBelowHvMinimum", LogLevel.Critical));
        foreach (var fact in new[] { AppointmentId.ToString(), expired.Id.ToString(), "2026-10-13", "policy 7", "required 3", "effective 0",
                     "legacy-hv-component,hv-components" })
        {
            entry.Message.ShouldContain(fact);
        }

        entry.Message.ShouldNotContain("Amelia");
        entry.Message.ShouldNotContain("T-1001");

        measurements.Clear();
        var valid = Technician.Create(Guid.NewGuid(), Site, "Ben Okafor", "T-1002", [], hvLevel: 3, hvLevelValidUntil: Day, hvLevelConfirmed: false);
        var quiet = new CapturingLogger<AllocationSafetyTests>();
        AllocationSafety.MeetsHvMinimum(valid, Requirements, Day, AppointmentId, quiet).ShouldBeTrue("expiry is inclusive and unconfirmed levels count");
        measurements.ShouldBeEmpty();
        quiet.Entries.ShouldBeEmpty();
    }
}

using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class TelemetryTests
{
    private static readonly DateTime Start = new(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Instrument_names_units_and_kinds_match_the_design()
    {
        // SYSTEM_DESIGN §12.1: dashboards and alerts depend on these names; renaming one is a breaking change.
        var published = new List<(string Name, string? Unit, string Kind)>();
        using (var listener = new MeterListener())
        {
            listener.InstrumentPublished = (instrument, _) =>
            {
                if (instrument.Meter.Name == SchedulerTelemetry.Name)
                {
                    published.Add((instrument.Name, instrument.Unit, instrument.GetType().Name));
                }
            };
            _ = SchedulerTelemetry.Cancellations; // ensure the type is initialised
            listener.Start();
        }

        SchedulerTelemetry.Name.ShouldBe("Keyloop.ServiceScheduler");
        SchedulerTelemetry.Source.Name.ShouldBe("Keyloop.ServiceScheduler");
        published.ShouldBe(
            [
                ("scheduler.booking.requests", "{request}", "Counter`1"),
                ("scheduler.booking.duration", "ms", "Histogram`1"),
                ("scheduler.booking.lock_wait", "ms", "Histogram`1"),
                ("scheduler.booking.constraint_backstop", "{event}", "Counter`1"),
                ("scheduler.booking.deadlocks", "{event}", "Counter`1"),
                ("scheduler.availability.duration", "ms", "Histogram`1"),
                ("scheduler.availability.slots_returned", "{slot}", "Histogram`1"),
                ("scheduler.appointments.cancellations", "{appointment}", "Counter`1"),
            ],
            ignoreOrder: true);
    }

    [Fact]
    public async Task Booked_event_is_logged_as_1001_with_ids_and_the_masked_vin()
    {
        var logger = new CapturingLogger<TelemetryDomainEventObserver>();
        var booked = new AppointmentBooked(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Start, Start.AddHours(1), "***********123456", Now);

        await new TelemetryDomainEventObserver(logger).OnCommittedAsync([booked], CancellationToken.None);

        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.EventId.ShouldBe(new EventId(1001, "BookingConfirmed"));
        entry.Level.ShouldBe(LogLevel.Information);
        foreach (var id in new[] { booked.AppointmentId, booked.DealershipId, booked.BayId, booked.TechnicianId })
        {
            entry.Message.ShouldContain(id.ToString());
        }

        entry.Message.ShouldContain("2026-10-13T08:00:00.0000000Z");
        entry.Message.ShouldContain("***********123456");
    }

    [Fact]
    public async Task Cancelled_event_is_logged_as_1010_and_counted_by_previous_status()
    {
        var measurements = new List<(long Value, KeyValuePair<string, object?>[] Tags)>();
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, l) =>
        {
            if (instrument.Meter.Name == SchedulerTelemetry.Name && instrument.Name == "scheduler.appointments.cancellations")
            {
                l.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((_, value, tags, _) =>
        {
            lock (measurements)
            {
                measurements.Add((value, tags.ToArray()));
            }
        });
        listener.Start();
        var logger = new CapturingLogger<TelemetryDomainEventObserver>();
        var cancelled = new AppointmentCancelled(Guid.NewGuid(), AppointmentStatus.CheckedIn, "Customer Jane Doe called to cancel", Now);

        await new TelemetryDomainEventObserver(logger).OnCommittedAsync([cancelled], CancellationToken.None);

        var measurement = measurements.ShouldHaveSingleItem();
        measurement.Value.ShouldBe(1);
        measurement.Tags.ShouldBe([new KeyValuePair<string, object?>("previous_status", "CheckedIn")]);

        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.EventId.ShouldBe(new EventId(1010, "AppointmentCancelled"));
        entry.Message.ShouldContain(cancelled.AppointmentId.ToString());
        entry.Message.ShouldContain("CheckedIn");
        entry.Message.ShouldNotContain("Jane Doe"); // the free-text reason may carry PII and is never logged
    }

    [Fact]
    public async Task Other_events_are_not_logged()
    {
        var logger = new CapturingLogger<TelemetryDomainEventObserver>();

        await new TelemetryDomainEventObserver(logger).OnCommittedAsync([new AppointmentCheckedIn(Guid.NewGuid(), Now)], CancellationToken.None);

        logger.Entries.ShouldBeEmpty();
    }
}

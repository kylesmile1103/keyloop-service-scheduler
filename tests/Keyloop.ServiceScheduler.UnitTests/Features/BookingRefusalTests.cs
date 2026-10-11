using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// What a refused booking insert means (SYSTEM_DESIGN §7.4): the answer, and the telemetry it owes. A deadlock (which ADR-003 rules out)
/// is answered as 409 <c>slot-conflict</c> with <c>conflictingResource</c> <c>unknown</c>, counted and logged at Warning, not retried.
/// </summary>
public class BookingRefusalTests
{
    private static readonly Guid DealershipId = Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e");

    [Fact]
    public void Bay_overlap_is_a_bay_slot_conflict_counted_as_a_backstop()
    {
        var refusal = BookingRefusal.For(PostgresFailure.BayOverlap).ShouldNotBeNull();

        refusal.Attempt.ShouldBe(new BookingAttempt.Conflict("bay"));
        refusal.BackstopConstraint.ShouldBe("ex_appointments_bay_no_overlap");
        refusal.Deadlock.ShouldBeFalse();
    }

    [Fact]
    public void Technician_overlap_is_a_technician_slot_conflict_counted_as_a_backstop()
    {
        var refusal = BookingRefusal.For(PostgresFailure.TechnicianOverlap).ShouldNotBeNull();

        refusal.Attempt.ShouldBe(new BookingAttempt.Conflict("technician"));
        refusal.BackstopConstraint.ShouldBe("ex_appointments_technician_no_overlap");
        refusal.Deadlock.ShouldBeFalse();
    }

    [Fact]
    public void Duplicate_idempotency_key_is_answered_from_the_stored_row_without_alarm()
    {
        var refusal = BookingRefusal.For(PostgresFailure.IdempotencyKeyDuplicate).ShouldNotBeNull();

        refusal.Attempt.ShouldBeOfType<BookingAttempt.DuplicateKey>();
        refusal.BackstopConstraint.ShouldBeNull();
        refusal.Deadlock.ShouldBeFalse();
    }

    [Fact]
    public void Deadlock_is_an_unknown_resource_slot_conflict_and_a_deadlock()
    {
        var refusal = BookingRefusal.For(PostgresFailure.Deadlock).ShouldNotBeNull();

        refusal.Attempt.ShouldBe(new BookingAttempt.Conflict("unknown"));
        refusal.BackstopConstraint.ShouldBeNull("no constraint fired");
        refusal.Deadlock.ShouldBeTrue();
    }

    [Theory]
    [InlineData(PostgresFailure.None)]
    [InlineData(PostgresFailure.CheckViolation)] // a domain guard bypassed: a bug, so a 500
    [InlineData(PostgresFailure.Other)]
    public void Anything_else_is_not_a_refusal(PostgresFailure failure) => BookingRefusal.For(failure).ShouldBeNull();

    [Fact]
    public void Every_classified_failure_has_a_decision() =>
        Enum.GetValues<PostgresFailure>().Where(f => BookingRefusal.For(f) is not null)
            .ShouldBe([PostgresFailure.BayOverlap, PostgresFailure.TechnicianOverlap, PostgresFailure.IdempotencyKeyDuplicate, PostgresFailure.Deadlock], ignoreOrder: true);

    [Fact]
    public void Recording_writes_exactly_the_telemetry_each_refusal_owes()
    {
        // One test, run sequentially: the instruments are process-wide and no other unit test touches these two.
        var measurements = new List<(string Instrument, long Value, string? Constraint)>();
        using var listener = new MeterListener
        {
            InstrumentPublished = (instrument, l) =>
            {
                if (ReferenceEquals(instrument.Meter, SchedulerTelemetry.Meter)
                    && instrument.Name is "scheduler.booking.deadlocks" or "scheduler.booking.constraint_backstop")
                {
                    l.EnableMeasurementEvents(instrument);
                }
            },
        };
        listener.SetMeasurementEventCallback<long>((instrument, value, tags, _) =>
            measurements.Add((instrument.Name, value, tags.ToArray().FirstOrDefault(t => t.Key == "constraint").Value as string)));
        listener.Start();
        var exception = new InvalidOperationException("40P01: deadlock detected");

        var deadlockLog = new CapturingLogger<BookingRefusalTests>();
        BookingRefusal.For(PostgresFailure.Deadlock)!.Record(exception, DealershipId, deadlockLog);
        measurements.ShouldBe([("scheduler.booking.deadlocks", 1, null)]);
        var entry = deadlockLog.Entries.ShouldHaveSingleItem();
        (entry.EventId.Id, entry.Level).ShouldBe((1004, LogLevel.Warning));
        entry.Exception.ShouldBeSameAs(exception);
        entry.Message.ShouldContain(DealershipId.ToString());

        measurements.Clear();
        var backstopLog = new CapturingLogger<BookingRefusalTests>();
        BookingRefusal.For(PostgresFailure.TechnicianOverlap)!.Record(exception, DealershipId, backstopLog);
        measurements.ShouldBe([("scheduler.booking.constraint_backstop", 1, "ex_appointments_technician_no_overlap")]);
        (backstopLog.Entries.ShouldHaveSingleItem().EventId.Id, backstopLog.Entries[0].Level).ShouldBe((1003, LogLevel.Warning));

        measurements.Clear();
        var duplicateLog = new CapturingLogger<BookingRefusalTests>();
        BookingRefusal.For(PostgresFailure.IdempotencyKeyDuplicate)!.Record(exception, DealershipId, duplicateLog);
        measurements.ShouldBeEmpty();
        duplicateLog.Entries.ShouldBeEmpty();
    }
}

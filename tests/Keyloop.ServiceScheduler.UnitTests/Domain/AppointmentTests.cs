using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Microsoft.Extensions.Time.Testing;
using static Keyloop.ServiceScheduler.Api.Domain.Scheduling.AppointmentStatus;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class AppointmentTests
{
    private static readonly DateOnly BookingDay = new(2026, 10, 13); // Tuesday; Europe/London is on BST (UTC+1)

    private static readonly Dictionary<string, Action<Appointment, DateTime>> Actions = new()
    {
        ["cancel"] = (appointment, nowUtc) => appointment.Cancel("Customer rescheduled", nowUtc),
        ["check in"] = (appointment, nowUtc) => appointment.CheckIn(nowUtc),
        ["start"] = (appointment, nowUtc) => appointment.Start(nowUtc),
        ["complete"] = (appointment, nowUtc) => appointment.Complete(nowUtc),
        ["mark as no-show"] = (appointment, nowUtc) => appointment.MarkNoShow(nowUtc),
    };

    private static readonly HashSet<(AppointmentStatus, string)> LegalTransitions =
    [
        (Confirmed, "cancel"),
        (Confirmed, "check in"),
        (Confirmed, "mark as no-show"),
        (CheckedIn, "cancel"),
        (CheckedIn, "start"),
        (InProgress, "complete"),
    ];

    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero));
    private readonly Dealership _reading;
    private readonly ServiceType _interim;
    private readonly ServiceBay _bay;
    private readonly Technician _technician;
    private readonly OperatingWindow _window;
    private readonly CustomerDetails _customer = new("Jane Doe", "jane.doe@example.com", "+44 7700 900123");
    private readonly VehicleDetails _vehicle = new(Vin.Create("WVWZZZ1KZAW123456"), "AB12 CDE", "Volkswagen", "Golf");

    public AppointmentTests()
    {
        _reading = Dealership.Create(
            Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), Now);
        _interim = ServiceType.Create(
            Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(60), [BayCapability.StandardLift], [Certification.GeneralService]);
        _bay = ServiceBay.Create(Guid.NewGuid(), _reading.Id, "Bay 1 — Standard", [BayCapability.StandardLift]);
        _technician = Technician.Create(Guid.NewGuid(), _reading.Id, "Amelia Clarke", "T-1001", [Certification.GeneralService, Certification.Brakes]);
        _window = _reading.ResolveOperatingWindow(BookingDay).ShouldNotBeNull();
    }

    public static TheoryData<AppointmentStatus, string> IllegalTransitions
    {
        get
        {
            var data = new TheoryData<AppointmentStatus, string>();
            foreach (var status in Enum.GetValues<AppointmentStatus>())
            {
                foreach (var action in Actions.Keys.Where(action => !LegalTransitions.Contains((status, action))))
                {
                    data.Add(status, action);
                }
            }

            return data;
        }
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    private static DateTime Utc(int hour, int minute = 0) => new(2026, 10, 13, hour, minute, 0, DateTimeKind.Utc);

    private TimeSlot LocalSlot(int hour, int minute = 0) =>
        TimeSlot.FromStart(LocalTimeConverter.ToUtc(BookingDay, new TimeOnly(hour, minute), _reading.TimeZone), _interim.Duration);

    private Appointment Book(
        Guid? id = null,
        ServiceBay? bay = null,
        Technician? technician = null,
        TimeSlot? slot = null,
        OperatingWindow? window = null,
        string? notes = null,
        DateTime? nowUtc = null) =>
        Appointment.Book(
            id ?? Guid.NewGuid(),
            _reading,
            _interim,
            bay ?? _bay,
            technician ?? _technician,
            slot ?? LocalSlot(9),
            window ?? _window,
            _customer,
            _vehicle,
            notes,
            nowUtc ?? Now);

    /// <summary>Books an appointment and drives it through legal transitions into <paramref name="status"/>, with events cleared.</summary>
    private Appointment InStatus(AppointmentStatus status)
    {
        var appointment = Book();
        switch (status)
        {
            case Confirmed:
                break;
            case CheckedIn:
                appointment.CheckIn(Now);
                break;
            case InProgress:
                appointment.CheckIn(Now);
                appointment.Start(Now);
                break;
            case Completed:
                appointment.CheckIn(Now);
                appointment.Start(Now);
                appointment.Complete(Now);
                break;
            case Cancelled:
                appointment.Cancel("Customer rescheduled", Now);
                break;
            case NoShow:
                appointment.MarkNoShow(appointment.Slot.EndUtc);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(status), status, null);
        }

        appointment.Status.ShouldBe(status);
        appointment.ClearDomainEvents();
        return appointment;
    }

    [Fact]
    public void Book_creates_confirmed_appointment_and_raises_event()
    {
        var id = Guid.NewGuid();
        var slot = LocalSlot(9);

        var appointment = Appointment.Book(id, _reading, _interim, _bay, _technician, slot, _window, _customer, _vehicle, "  Customer will wait  ", Now);

        slot.ShouldBe(TimeSlot.Create(Utc(8), Utc(9)));
        appointment.Id.ShouldBe(id);
        appointment.DealershipId.ShouldBe(_reading.Id);
        appointment.ServiceTypeId.ShouldBe(_interim.Id);
        appointment.BayId.ShouldBe(_bay.Id);
        appointment.TechnicianId.ShouldBe(_technician.Id);
        appointment.Slot.ShouldBe(slot);
        appointment.Customer.ShouldBe(_customer);
        appointment.Vehicle.ShouldBe(_vehicle);
        appointment.Status.ShouldBe(Confirmed);
        appointment.IsActive.ShouldBeTrue();
        appointment.Notes.ShouldBe("Customer will wait");
        appointment.CancellationReason.ShouldBeNull();
        appointment.CreatedAtUtc.ShouldBe(Now);
        appointment.UpdatedAtUtc.ShouldBe(Now);
        appointment.RowVersion.ShouldBe(0u);

        var booked = appointment.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<AppointmentBooked>();
        booked.ShouldBe(new AppointmentBooked(id, _reading.Id, _interim.Id, _bay.Id, _technician.Id, Utc(8), Utc(9), _vehicle.Vin.Masked, Now));
        booked.EventType.ShouldBe("Booked");
        booked.MaskedVin.ShouldBe("***********123456");
        booked.ToString().ShouldNotContain(_vehicle.Vin.Value);
    }

    [Fact]
    public void Book_rejects_bay_from_other_dealership()
    {
        var foreignBay = ServiceBay.Create(Guid.NewGuid(), Guid.NewGuid(), "Halle 1", [BayCapability.StandardLift]);

        Should.Throw<DomainRuleViolationException>(() => Book(bay: foreignBay)).RuleCode.ShouldBe("no-qualified-resources");
    }

    [Fact]
    public void Book_rejects_technician_from_other_dealership()
    {
        var foreignTechnician = Technician.Create(Guid.NewGuid(), Guid.NewGuid(), "Greta Vogel", "M-2001", [Certification.GeneralService]);

        Should.Throw<DomainRuleViolationException>(() => Book(technician: foreignTechnician)).RuleCode.ShouldBe("no-qualified-resources");
    }

    [Fact]
    public void Book_rejects_inactive_bay()
    {
        _bay.Deactivate();

        Should.Throw<DomainRuleViolationException>(() => Book()).RuleCode.ShouldBe("no-qualified-resources");

        _bay.Activate();
        Should.NotThrow(() => Book());
    }

    [Fact]
    public void Book_rejects_inactive_technician()
    {
        var offDuty = Technician.Create(Guid.NewGuid(), _reading.Id, "Off Duty", "T-1999", [Certification.GeneralService], isActive: false);

        Should.Throw<DomainRuleViolationException>(() => Book(technician: offDuty)).RuleCode.ShouldBe("no-qualified-resources");
    }

    [Fact]
    public void Book_rejects_incompatible_bay()
    {
        var evBay = ServiceBay.Create(Guid.NewGuid(), _reading.Id, "Bay 7 — EV only", [BayCapability.EvHighVoltage]);

        var ex = Should.Throw<DomainRuleViolationException>(() => Book(bay: evBay));

        ex.RuleCode.ShouldBe("no-qualified-resources");
        ex.Extensions["missingCapabilities"].ShouldBe(new[] { BayCapability.StandardLift });
        ex.Extensions["missingCertifications"].ShouldBe(Array.Empty<Certification>());
    }

    [Fact]
    public void Book_rejects_uncertified_technician()
    {
        var evSpecialist = Technician.Create(Guid.NewGuid(), _reading.Id, "Ben Okafor", "T-1002", [Certification.HighVoltageElectrical]);

        var ex = Should.Throw<DomainRuleViolationException>(() => Book(technician: evSpecialist));

        ex.RuleCode.ShouldBe("no-qualified-resources");
        ex.Extensions["missingCapabilities"].ShouldBe(Array.Empty<BayCapability>());
        ex.Extensions["missingCertifications"].ShouldBe(new[] { Certification.GeneralService });
    }

    [Fact]
    public void Book_rejects_slot_outside_window()
    {
        _window.ShouldBe(new OperatingWindow(Utc(7), Utc(17)));

        var ex = Should.Throw<DomainRuleViolationException>(() => Book(slot: LocalSlot(17, 30))); // 17:30-18:30 local

        ex.RuleCode.ShouldBe("outside-operating-hours");
        ex.Extensions["operatingWindow"].ShouldBe(new OperatingWindow(Utc(7), Utc(17)));

        Should.Throw<DomainRuleViolationException>(() => Book(slot: LocalSlot(7, 30))).RuleCode.ShouldBe("outside-operating-hours");
    }

    [Fact]
    public void Book_accepts_slot_ending_exactly_at_close()
    {
        var lastSlot = LocalSlot(17); // 17:00-18:00 local, ends exactly at closing time

        var appointment = Book(slot: lastSlot);

        appointment.Slot.ShouldBe(TimeSlot.Create(Utc(16), Utc(17)));
        Book(slot: LocalSlot(8)).Slot.StartUtc.ShouldBe(_window.StartUtc); // and one starting exactly at opening
    }

    [Fact]
    public void Book_rejects_slot_whose_duration_differs_from_the_service()
    {
        var ninetyMinutes = TimeSlot.Create(Utc(8), Utc(9, 30));

        Should.Throw<ArgumentException>(() => Book(slot: ninetyMinutes)).ParamName.ShouldBe("slot");
    }

    [Fact]
    public void Book_validates_arguments()
    {
        Should.Throw<ArgumentException>(() => Book(id: Guid.Empty)).ParamName.ShouldBe("id");
        Should.Throw<ArgumentException>(() => Book(nowUtc: DateTime.SpecifyKind(Now, DateTimeKind.Unspecified))).ParamName.ShouldBe("nowUtc");
        Should.Throw<ArgumentException>(() => Book(window: default(OperatingWindow))).ParamName.ShouldBe("window");
        Should.Throw<ArgumentException>(() => Book(notes: new string('n', 1001))).ParamName.ShouldBe("notes");
        Should.Throw<ArgumentNullException>(() =>
            Appointment.Book(Guid.NewGuid(), _reading, _interim, _bay, _technician, LocalSlot(9), _window, null!, _vehicle, null, Now))
            .ParamName.ShouldBe("customer");

        Book(notes: "   ").Notes.ShouldBeNull();
        Book(notes: null).Notes.ShouldBeNull();
        Book(notes: new string('n', 1000)).Notes!.Length.ShouldBe(1000);
    }

    [Fact]
    public void Cancel_from_confirmed_sets_reason_and_raises_event()
    {
        var appointment = Book();
        var bookedAt = Now;
        appointment.ClearDomainEvents();
        _clock.Advance(TimeSpan.FromHours(2));

        appointment.Cancel("  Customer rescheduled  ", Now);

        appointment.Status.ShouldBe(Cancelled);
        appointment.IsActive.ShouldBeFalse();
        appointment.CancellationReason.ShouldBe("Customer rescheduled");
        appointment.CreatedAtUtc.ShouldBe(bookedAt);
        appointment.UpdatedAtUtc.ShouldBe(Now);
        var cancelled = appointment.DomainEvents.ShouldHaveSingleItem();
        cancelled.ShouldBe(new AppointmentCancelled(appointment.Id, Confirmed, "Customer rescheduled", Now));
        cancelled.EventType.ShouldBe("Cancelled");
    }

    [Fact]
    public void Cancel_from_checked_in_records_previous_status()
    {
        var appointment = InStatus(CheckedIn);

        appointment.Cancel("Vehicle needs a part we do not stock", Now);

        appointment.Status.ShouldBe(Cancelled);
        appointment.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<AppointmentCancelled>().PreviousStatus.ShouldBe(CheckedIn);
    }

    [Fact]
    public void Cancel_twice_throws_invalid_state_transition()
    {
        var appointment = Book();
        appointment.Cancel("Customer rescheduled", Now);
        appointment.ClearDomainEvents();

        var ex = Should.Throw<InvalidStateTransitionException>(() => appointment.Cancel("Second attempt", Now));

        ex.Current.ShouldBe(Cancelled);
        ex.Attempted.ShouldBe("cancel");
        appointment.CancellationReason.ShouldBe("Customer rescheduled");
        appointment.DomainEvents.ShouldBeEmpty();
    }

    [Fact]
    public void Cancel_requires_reason()
    {
        var appointment = Book();
        appointment.ClearDomainEvents();

        Should.Throw<ArgumentException>(() => appointment.Cancel("", Now)).ParamName.ShouldBe("reason");
        Should.Throw<ArgumentException>(() => appointment.Cancel("   ", Now)).ParamName.ShouldBe("reason");
        Should.Throw<ArgumentException>(() => appointment.Cancel(null!, Now)).ParamName.ShouldBe("reason");
        Should.Throw<ArgumentException>(() => appointment.Cancel(new string('r', 501), Now)).ParamName.ShouldBe("reason");
        appointment.Status.ShouldBe(Confirmed);
        appointment.CancellationReason.ShouldBeNull();
        appointment.DomainEvents.ShouldBeEmpty();

        appointment.Cancel(new string('r', 500), Now);
        appointment.CancellationReason.ShouldNotBeNull().Length.ShouldBe(500);
    }

    [Fact]
    public void Full_happy_lifecycle()
    {
        var appointment = Book();
        var bookedAt = Now;

        _clock.Advance(TimeSpan.FromDays(1) - TimeSpan.FromMinutes(5)); // 07:55Z on the booking day
        var checkedInAt = Now;
        appointment.CheckIn(checkedInAt);
        appointment.Status.ShouldBe(CheckedIn);
        appointment.IsActive.ShouldBeTrue();
        appointment.UpdatedAtUtc.ShouldBe(checkedInAt);

        _clock.Advance(TimeSpan.FromMinutes(10));
        var startedAt = Now;
        appointment.Start(startedAt);
        appointment.Status.ShouldBe(InProgress);
        appointment.IsActive.ShouldBeTrue();
        appointment.UpdatedAtUtc.ShouldBe(startedAt);

        _clock.Advance(TimeSpan.FromMinutes(55));
        var completedAt = Now;
        appointment.Complete(completedAt);
        appointment.Status.ShouldBe(Completed);
        appointment.IsActive.ShouldBeFalse();
        appointment.UpdatedAtUtc.ShouldBe(completedAt);
        appointment.CreatedAtUtc.ShouldBe(bookedAt);

        appointment.DomainEvents.Select(e => e.EventType).ShouldBe(["Booked", "CheckedIn", "Started", "Completed"]);
        appointment.DomainEvents.Select(e => e.OccurredAtUtc).ShouldBe([bookedAt, checkedInAt, startedAt, completedAt]);
        appointment.DomainEvents.ShouldAllBe(e => e.AppointmentId == appointment.Id);
        appointment.DomainEvents.Skip(1).ShouldBe(
        [
            new AppointmentCheckedIn(appointment.Id, checkedInAt),
            new AppointmentStarted(appointment.Id, startedAt),
            new AppointmentCompleted(appointment.Id, completedAt),
        ]);
    }

    [Fact]
    public void Start_from_confirmed_is_invalid()
    {
        var appointment = InStatus(Confirmed);

        var ex = Should.Throw<InvalidStateTransitionException>(() => appointment.Start(Now));

        ex.Current.ShouldBe(Confirmed);
        ex.Attempted.ShouldBe("start");
        appointment.Status.ShouldBe(Confirmed);
        appointment.DomainEvents.ShouldBeEmpty();
    }

    [Theory]
    [MemberData(nameof(IllegalTransitions))]
    public void Illegal_transitions_throw_and_leave_the_appointment_unchanged(AppointmentStatus status, string action)
    {
        var appointment = InStatus(status);
        var updatedAt = appointment.UpdatedAtUtc;
        var afterSlotEnd = appointment.Slot.EndUtc.AddHours(1);

        var ex = Should.Throw<InvalidStateTransitionException>(() => Actions[action](appointment, afterSlotEnd));

        ex.Current.ShouldBe(status);
        ex.Attempted.ShouldBe(action);
        appointment.Status.ShouldBe(status);
        appointment.UpdatedAtUtc.ShouldBe(updatedAt);
        appointment.DomainEvents.ShouldBeEmpty();
    }

    [Fact]
    public void Illegal_transition_matrix_covers_every_status_and_action() =>
        IllegalTransitions.Count.ShouldBe((Enum.GetValues<AppointmentStatus>().Length * Actions.Count) - LegalTransitions.Count);

    [Fact]
    public void Only_confirmed_checked_in_and_in_progress_are_active()
    {
        Appointment.ActiveStatuses.ShouldBe([Confirmed, CheckedIn, InProgress]);

        foreach (var status in Enum.GetValues<AppointmentStatus>())
        {
            InStatus(status).IsActive.ShouldBe(Appointment.ActiveStatuses.Contains(status), status.ToString());
        }
    }

    [Fact]
    public void MarkNoShow_before_slot_end_is_rule_violation()
    {
        var appointment = InStatus(Confirmed);

        var ex = Should.Throw<DomainRuleViolationException>(() => appointment.MarkNoShow(appointment.Slot.EndUtc.AddTicks(-1)));

        ex.RuleCode.ShouldBe("no-show-before-slot-end");
        appointment.Status.ShouldBe(Confirmed);
        appointment.DomainEvents.ShouldBeEmpty();

        appointment.MarkNoShow(appointment.Slot.EndUtc); // the half-open slot has ended
        appointment.Status.ShouldBe(NoShow);
        appointment.IsActive.ShouldBeFalse();
        appointment.UpdatedAtUtc.ShouldBe(appointment.Slot.EndUtc);
        var noShow = appointment.DomainEvents.ShouldHaveSingleItem();
        noShow.ShouldBe(new AppointmentNoShow(appointment.Id, appointment.Slot.EndUtc));
        noShow.EventType.ShouldBe("NoShow");
    }

    [Fact]
    public void Transitions_require_utc_now()
    {
        var unspecified = DateTime.SpecifyKind(Now, DateTimeKind.Unspecified);

        Should.Throw<ArgumentException>(() => Book().Cancel("Customer rescheduled", unspecified)).ParamName.ShouldBe("nowUtc");
        Should.Throw<ArgumentException>(() => Book().CheckIn(unspecified)).ParamName.ShouldBe("nowUtc");
        Should.Throw<ArgumentException>(() => InStatus(CheckedIn).Start(unspecified)).ParamName.ShouldBe("nowUtc");
        Should.Throw<ArgumentException>(() => InStatus(InProgress).Complete(unspecified)).ParamName.ShouldBe("nowUtc");
        Should.Throw<ArgumentException>(() => Book().MarkNoShow(DateTime.SpecifyKind(Utc(12), DateTimeKind.Local))).ParamName.ShouldBe("nowUtc");
    }

    [Fact]
    public void Events_are_raised_once_and_cleared()
    {
        var appointment = Book();
        appointment.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<AppointmentBooked>();

        appointment.ClearDomainEvents();
        appointment.DomainEvents.ShouldBeEmpty();

        appointment.CheckIn(Now);
        appointment.DomainEvents.ShouldHaveSingleItem().ShouldBeOfType<AppointmentCheckedIn>().EventType.ShouldBe("CheckedIn");

        Should.Throw<InvalidStateTransitionException>(() => appointment.CheckIn(Now));
        appointment.DomainEvents.Count.ShouldBe(1);

        appointment.ClearDomainEvents();
        appointment.Start(Now);
        appointment.DomainEvents.ShouldHaveSingleItem().EventType.ShouldBe("Started");
    }
}

using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>
/// The booking aggregate: binds dealership, service type, customer, vehicle, bay, technician and slot, and owns the
/// lifecycle in ARCHITECTURE §5.5. Other aggregates are referenced by id only. Overlap with other appointments is a
/// per-resource invariant enforced by the booking handler's locked pre-check and the database exclusion constraints
/// (§7.3), not here.
/// </summary>
public sealed class Appointment : AggregateRoot
{
    public const int MaxNotesLength = 1000;

    public const int MaxCancellationReasonLength = 500;

    private const string NoQualifiedResources = "no-qualified-resources";
    private const string NoShowBeforeSlotEnd = "no-show-before-slot-end";

    // The 422 detail reaches clients verbatim, so it never names individual bays or technicians (ARCHITECTURE §8.7).
    private const string NoQualifiedResourcesDetail = "The selected bay or technician cannot perform this service at this dealership.";

    // Machine tokens: they reach clients as the 409 invalid-state-transition "attempted" extension (ARCHITECTURE §8.7).
    private const string CancelAction = "cancel";
    private const string CheckInAction = "check-in";
    private const string StartAction = "start";
    private const string CompleteAction = "complete";
    private const string MarkNoShowAction = "mark-no-show";

    // EF Core materialisation.
    private Appointment()
    {
        Slot = null!;
        Customer = null!;
        Vehicle = null!;
    }

    private Appointment(
        Guid id,
        Guid dealershipId,
        Guid serviceTypeId,
        Guid bayId,
        Guid technicianId,
        TimeSlot slot,
        CustomerDetails customer,
        VehicleDetails vehicle,
        string? notes,
        DateTime nowUtc)
    {
        Id = id;
        DealershipId = dealershipId;
        ServiceTypeId = serviceTypeId;
        BayId = bayId;
        TechnicianId = technicianId;
        Slot = slot;
        Customer = customer;
        Vehicle = vehicle;
        Status = AppointmentStatus.Confirmed;
        Notes = notes;
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>Statuses that occupy a bay and a technician; the exclusion constraints' partial <c>WHERE</c> uses the same set.</summary>
    public static IReadOnlyList<AppointmentStatus> ActiveStatuses { get; } =
        [AppointmentStatus.Confirmed, AppointmentStatus.CheckedIn, AppointmentStatus.InProgress];

    public Guid DealershipId { get; private set; }

    public Guid ServiceTypeId { get; private set; }

    public Guid BayId { get; private set; }

    public Guid TechnicianId { get; private set; }

    public TimeSlot Slot { get; private set; }

    public CustomerDetails Customer { get; private set; }

    public VehicleDetails Vehicle { get; private set; }

    public AppointmentStatus Status { get; private set; }

    public string? Notes { get; private set; }

    public string? CancellationReason { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>PostgreSQL <c>xmin</c>: the optimistic concurrency token for state transitions. Only the database sets it.</summary>
    public uint RowVersion { get; private set; }

    public bool IsActive => Status is AppointmentStatus.Confirmed or AppointmentStatus.CheckedIn or AppointmentStatus.InProgress;

    /// <summary>
    /// Creates a <see cref="AppointmentStatus.Confirmed"/> appointment and raises <see cref="AppointmentBooked"/>. Re-asserts the
    /// invariants the handler has already filtered for (ARCHITECTURE §5.4): qualified, active resources of this dealership, and a
    /// slot inside the operating window. Lead time and horizon belong to <see cref="BookingWindowPolicy"/>.
    /// </summary>
    /// <exception cref="ArgumentException">A programming error: empty id, non-UTC instant, slot length different from the service duration, or notes too long.</exception>
    /// <exception cref="DomainRuleViolationException"><c>no-qualified-resources</c> or <c>outside-operating-hours</c>.</exception>
    public static Appointment Book(
        Guid id,
        Dealership dealership,
        ServiceType serviceType,
        ServiceBay bay,
        Technician technician,
        TimeSlot slot,
        OperatingWindow window,
        CustomerDetails customer,
        VehicleDetails vehicle,
        string? notes,
        DateTime nowUtc)
    {
        Guard.NotEmpty(id, nameof(id));
        ArgumentNullException.ThrowIfNull(dealership);
        ArgumentNullException.ThrowIfNull(serviceType);
        ArgumentNullException.ThrowIfNull(bay);
        ArgumentNullException.ThrowIfNull(technician);
        ArgumentNullException.ThrowIfNull(slot);
        ArgumentNullException.ThrowIfNull(customer);
        ArgumentNullException.ThrowIfNull(vehicle);
        Guard.Utc(window.StartUtc, nameof(window));
        Guard.Utc(window.EndUtc, nameof(window));
        Guard.Utc(nowUtc, nameof(nowUtc));
        var normalisedNotes = NormaliseNotes(notes);

        if (slot.Duration != serviceType.Duration.AsTimeSpan)
        {
            throw new ArgumentException(
                string.Create(CultureInfo.InvariantCulture, $"The slot lasts {slot.Duration.TotalMinutes:0} minutes but {serviceType.Code} takes {serviceType.Duration.Minutes}."),
                nameof(slot));
        }

        if (bay.DealershipId != dealership.Id || !bay.IsActive || technician.DealershipId != dealership.Id || !technician.IsActive)
        {
            throw new DomainRuleViolationException(NoQualifiedResources, NoQualifiedResourcesDetail);
        }

        if (!bay.Supports(serviceType) || !technician.IsCertifiedFor(serviceType))
        {
            throw new DomainRuleViolationException(
                NoQualifiedResources,
                NoQualifiedResourcesDetail,
                new Dictionary<string, object?>
                {
                    ["missingCapabilities"] = serviceType.RequiredBayCapabilities.Except(bay.Capabilities).Order().ToArray(),
                    ["missingCertifications"] = serviceType.RequiredCertifications.Except(technician.Certifications).Order().ToArray(),
                });
        }

        BookingWindowPolicy.EnsureWithinOperatingHours(dealership, slot, window);

        var appointment = new Appointment(id, dealership.Id, serviceType.Id, bay.Id, technician.Id, slot, customer, vehicle, normalisedNotes, nowUtc);
        appointment.Raise(new AppointmentBooked(
            id, dealership.Id, serviceType.Id, bay.Id, technician.Id, slot.StartUtc, slot.EndUtc, vehicle.Vin.Masked, nowUtc));
        return appointment;
    }

    /// <summary>Confirmed or CheckedIn → Cancelled. The slot is immediately re-bookable (terminal statuses are outside the exclusion constraints).</summary>
    public void Cancel(string reason, DateTime nowUtc)
    {
        var trimmedReason = Guard.Required(reason, 1, MaxCancellationReasonLength, nameof(reason));
        Guard.Utc(nowUtc, nameof(nowUtc));
        if (Status is not (AppointmentStatus.Confirmed or AppointmentStatus.CheckedIn))
        {
            throw new InvalidStateTransitionException(Status, CancelAction);
        }

        var previousStatus = Status;
        CancellationReason = trimmedReason;
        MoveTo(AppointmentStatus.Cancelled, nowUtc);
        Raise(new AppointmentCancelled(Id, previousStatus, trimmedReason, nowUtc));
    }

    /// <summary>Confirmed → CheckedIn (the vehicle has arrived).</summary>
    public void CheckIn(DateTime nowUtc)
    {
        Guard.Utc(nowUtc, nameof(nowUtc));
        EnsureStatus(AppointmentStatus.Confirmed, CheckInAction);
        MoveTo(AppointmentStatus.CheckedIn, nowUtc);
        Raise(new AppointmentCheckedIn(Id, nowUtc));
    }

    /// <summary>CheckedIn → InProgress (the technician has begun work).</summary>
    public void Start(DateTime nowUtc)
    {
        Guard.Utc(nowUtc, nameof(nowUtc));
        EnsureStatus(AppointmentStatus.CheckedIn, StartAction);
        MoveTo(AppointmentStatus.InProgress, nowUtc);
        Raise(new AppointmentStarted(Id, nowUtc));
    }

    /// <summary>InProgress → Completed.</summary>
    public void Complete(DateTime nowUtc)
    {
        Guard.Utc(nowUtc, nameof(nowUtc));
        EnsureStatus(AppointmentStatus.InProgress, CompleteAction);
        MoveTo(AppointmentStatus.Completed, nowUtc);
        Raise(new AppointmentCompleted(Id, nowUtc));
    }

    /// <summary>Confirmed → NoShow, allowed only once the (half-open) slot has ended.</summary>
    public void MarkNoShow(DateTime nowUtc)
    {
        Guard.Utc(nowUtc, nameof(nowUtc));
        EnsureStatus(AppointmentStatus.Confirmed, MarkNoShowAction);
        if (nowUtc < Slot.EndUtc)
        {
            throw new DomainRuleViolationException(
                NoShowBeforeSlotEnd,
                string.Create(CultureInfo.InvariantCulture, $"An appointment can be marked as a no-show only after its slot ends at {Slot.EndUtc:yyyy-MM-dd'T'HH:mm:ss'Z'}."));
        }

        MoveTo(AppointmentStatus.NoShow, nowUtc);
        Raise(new AppointmentNoShow(Id, nowUtc));
    }

    private static string? NormaliseNotes(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes))
        {
            return null;
        }

        var trimmed = notes.Trim();
        return trimmed.Length <= MaxNotesLength
            ? trimmed
            : throw new ArgumentException($"notes must be at most {MaxNotesLength} characters.", nameof(notes));
    }

    private void EnsureStatus(AppointmentStatus required, string attempted)
    {
        if (Status != required)
        {
            throw new InvalidStateTransitionException(Status, attempted);
        }
    }

    private void MoveTo(AppointmentStatus next, DateTime nowUtc)
    {
        Status = next;
        UpdatedAtUtc = nowUtc;
    }
}

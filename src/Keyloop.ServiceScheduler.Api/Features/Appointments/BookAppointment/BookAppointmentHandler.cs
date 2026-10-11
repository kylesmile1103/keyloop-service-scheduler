using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Books one appointment (SYSTEM_DESIGN §6.3, §7.3–§7.5). In order: the <c>Idempotency-Key</c> is looked up without a lock (a retry of
/// a committed booking is replayed before any rule could reject it); the lock-free rules are checked (404s and the 422s); then one
/// transaction at <c>READ COMMITTED</c> takes the dealership's advisory lock, looks the key up again (a concurrent request with it may
/// have committed while this one waited), re-checks availability, allocates, and inserts the appointment, its history row and the
/// memoised response. That transaction takes exactly one lock and makes exactly one contended insert (ADR-003). An overlap the
/// pre-check could not see (a writer outside this path) is refused by the exclusion constraints: 409 <c>slot-conflict</c>, counted on
/// <c>scheduler.booking.constraint_backstop</c>. Only successful bookings are memoised: any refusal rolls the key row back with the rest.
/// </summary>
/// <remarks>
/// The aggregate's <c>AppointmentBooked</c> event becomes the history row inside the transaction and is logged (1001) by
/// <see cref="TelemetryDomainEventObserver"/> after the commit; refusals are logged here as 1002, a backstop as 1003, a deadlock as 1004.
/// </remarks>
public sealed class BookAppointmentHandler(
    SchedulerDbContext db,
    DayScheduleReader reader,
    BookingWindowPolicy windowPolicy,
    IOptions<SchedulingOptions> options,
    TimeProvider clock,
    ILogger<BookAppointmentHandler> logger)
{
    /// <summary>How long a successful booking's response is replayed for its <c>Idempotency-Key</c>.</summary>
    public static readonly TimeSpan IdempotencyKeyLifetime = TimeSpan.FromHours(24);

    // The 422 detail reaches clients verbatim, so it never names individual bays or technicians (SYSTEM_DESIGN §8.7).
    private const string NoQualifiedResourcesDetail =
        "This dealership has no active bay with every capability, or no active technician with every certification, that the service requires.";

    public async Task<BookAppointmentResult> HandleAsync(BookAppointmentCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);
        var request = command.Request;
        var key = command.IdempotencyKey;

        using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.book_appointment");
        activity?.SetTag("dealership.id", command.DealershipId.ToString());
        activity?.SetTag("booking.requested_start_utc", request.StartUtc.ToString("O", CultureInfo.InvariantCulture));
        var started = clock.GetTimestamp();
        var outcome = BookingOutcomes.Error;
        string? serviceCode = null;
        try
        {
            var fingerprint = key is null ? null : IdempotencyFingerprint.Compute(command.DealershipId, request);

            // 1. The key, without a lock and before every rule: a retry of a booking that committed gets the stored 201, even when time
            //    has since moved past the lead time, and never reaches the availability check, where it would meet its own appointment.
            if (key is not null && await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct) is { } early
                && IsLive(early, Now()))
            {
                var replay = Replay(early, fingerprint!, activity);
                outcome = BookingOutcomes.Replayed;
                return replay;
            }

            // 2. The rules that need no lock: unknown ids (404), opening hours, lead time and horizon, slot grid, qualified resources (422).
            var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == command.DealershipId, ct)
                ?? throw new NotFoundException(ProblemResources.Dealership, command.DealershipId);
            var serviceType = await db.ServiceTypes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.ServiceTypeId, ct)
                ?? throw new NotFoundException(ProblemResources.ServiceType, request.ServiceTypeId);
            serviceCode = serviceType.Code;
            activity?.SetTag("service_type.code", serviceCode);

            var slot = TimeSlot.FromStart(request.StartUtc, serviceType.Duration);
            var window = BookingWindowPolicy.OperatingWindowFor(dealership, slot);
            windowPolicy.EnsureBookable(slot.StartUtc);
            BookingWindowPolicy.EnsureAligned(slot.StartUtc, window, options.Value.SlotGranularityMinutes);
            var (compatibleBays, certifiedTechnicians) = await QualifiedResourcesAsync(dealership.Id, serviceType, ct);
            var booking = new Booking(
                command, fingerprint, dealership, serviceType, slot, window, compatibleBays, certifiedTechnicians, ToCustomer(request.Customer), ToVehicle(request.Vehicle));

            // 3. The transaction, run again from the start by the retrying execution strategy after a transient failure.
            var attempt = await db.Database.CreateExecutionStrategy().ExecuteAsync(token => AttemptAsync(booking, token), ct);

            switch (attempt)
            {
                case BookingAttempt.Confirmed confirmed:
                    activity?.SetTag("booking.bay_id", confirmed.Bay.Id.ToString());
                    activity?.SetTag("booking.technician_id", confirmed.Technician.Id.ToString());
                    activity?.SetTag("idempotency.replayed", false);
                    outcome = BookingOutcomes.Confirmed;
                    return new BookAppointmentResult(
                        AppointmentResponseMapper.Map(confirmed.Appointment, dealership.TimeZone, serviceType, confirmed.Bay, confirmed.Technician), Replayed: false);

                case BookingAttempt.Unavailable:
                    throw new SlotUnavailableException(await SuggestAsync(booking, ct));

                case BookingAttempt.Conflict conflict:
                    throw new SlotConflictException(conflict.Resource, await SuggestAsync(booking, ct));

                case BookingAttempt.KeyInUse inUse:
                {
                    var replay = Replay(inUse.Stored, fingerprint!, activity);
                    outcome = BookingOutcomes.Replayed;
                    return replay;
                }

                case BookingAttempt.DuplicateKey:
                {
                    // The other request committed its key before this one's insert failed, so the row is there to answer from.
                    var stored = await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct)
                        ?? throw new InvalidOperationException("The Idempotency-Key insert failed as a duplicate, yet no row has that key.");
                    var replay = Replay(stored, fingerprint!, activity);
                    outcome = BookingOutcomes.Replayed;
                    return replay;
                }

                default:
                    throw new UnreachableException($"Unhandled booking attempt {attempt.GetType().Name}.");
            }
        }
        catch (NotFoundException)
        {
            outcome = BookingOutcomes.NotFound;
            throw;
        }
        catch (DomainRuleViolationException)
        {
            outcome = BookingOutcomes.RuleViolation;
            throw;
        }
        catch (SlotUnavailableException)
        {
            outcome = BookingOutcomes.SlotUnavailable;
            throw;
        }
        catch (SlotConflictException)
        {
            outcome = BookingOutcomes.SlotConflict;
            throw;
        }
        catch (IdempotencyKeyReuseException)
        {
            outcome = BookingOutcomes.IdempotencyReuse;
            throw;
        }
        finally
        {
            activity?.SetTag("booking.outcome", outcome);
            SchedulerTelemetry.BookingRequests.Add(
                1, new KeyValuePair<string, object?>("outcome", outcome), new KeyValuePair<string, object?>("dealership.id", command.DealershipId.ToString()));
            SchedulerTelemetry.BookingDuration.Record(clock.GetElapsedTime(started).TotalMilliseconds, new KeyValuePair<string, object?>("outcome", outcome));
            if (BookingOutcomes.IsRejection(outcome))
            {
                logger.BookingRejected(outcome, command.DealershipId, serviceCode);
            }
        }
    }

    /// <summary>One run of the booking transaction; see the class summary for the order and why it cannot double-book.</summary>
    private async Task<BookingAttempt> AttemptAsync(Booking booking, CancellationToken ct)
    {
        // A retried run starts from nothing: what a failed run added must not be saved by this one.
        db.ChangeTracker.Clear();
        var nowOffset = clock.GetUtcNow();
        var now = ToMicroseconds(nowOffset.UtcDateTime);
        var dealershipId = booking.Dealership.Id;
        var request = booking.Command.Request;

        // READ COMMITTED, not REPEATABLE READ: each statement after the lock takes a fresh snapshot, so it sees what the previous
        // holder of the lock committed (a REPEATABLE READ snapshot would date from before the wait). ADR-004.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await AcquireLockAsync(dealershipId, ct);

        if (booking.Command.IdempotencyKey is { } key)
        {
            var stored = await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct);
            if (stored is not null && IsLive(stored, now))
            {
                await transaction.RollbackAsync(ct);
                return new BookingAttempt.KeyInUse(stored);
            }

            if (stored is not null)
            {
                // Expired: the key starts over with this booking, in this transaction, so the insert below cannot collide with it.
                await db.IdempotencyKeys.Where(k => k.Key == key && k.ExpiresAtUtc <= now).ExecuteDeleteAsync(ct);
            }
        }

        // The pre-check: active appointments of this dealership overlapping the slot (half-open), as of the previous holder's commit.
        var (start, end) = (booking.Slot.StartUtc, booking.Slot.EndUtc);
        var busy = await db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == dealershipId && Appointment.ActiveStatuses.Contains(a.Status) && a.Slot.StartUtc < end && a.Slot.EndUtc > start)
            .Select(a => new { a.BayId, a.TechnicianId })
            .ToListAsync(ct);
        var busyBays = busy.Select(a => a.BayId).ToHashSet();
        var busyTechnicians = busy.Select(a => a.TechnicianId).ToHashSet();
        var freeBays = booking.CompatibleBays.Where(b => !busyBays.Contains(b.Id)).ToList();
        var freeTechnicians = booking.CertifiedTechnicians.Where(t => !busyTechnicians.Contains(t.Id)).ToList();
        if (freeBays.Count == 0 || freeTechnicians.Count == 0)
        {
            await transaction.RollbackAsync(ct);
            return new BookingAttempt.Unavailable();
        }

        var load = await reader.LoadCountsAsync(dealershipId, booking.Window, ct);
        var bay = AllocationPolicy.ChooseBay(freeBays, booking.ServiceType, load, request.PreferredBayId)!;
        var technician = AllocationPolicy.ChooseTechnician(freeTechnicians, booking.ServiceType, load, request.PreferredTechnicianId)!;
        var appointment = Appointment.Book(
            Guid.CreateVersion7(nowOffset), booking.Dealership, booking.ServiceType, bay, technician, booking.Slot, booking.Window, booking.Customer,
            booking.Vehicle, request.Notes, now);
        db.Appointments.Add(appointment);

        if (booking.Command.IdempotencyKey is { } newKey)
        {
            var response = AppointmentResponseMapper.Map(appointment, booking.Dealership.TimeZone, booking.ServiceType, bay, technician);
            db.IdempotencyKeys.Add(new IdempotencyKey
            {
                Key = newKey,
                RequestFingerprint = booking.Fingerprint!,
                ResponseStatus = StatusCodes.Status201Created,
                ResponseBody = JsonSerializer.Serialize(response, SchedulerJsonContext.Default.AppointmentResponse),
                ResourceId = appointment.Id,
                CreatedAtUtc = now,
                ExpiresAtUtc = now + IdempotencyKeyLifetime,
            });
        }

        try
        {
            // The interceptor adds the history row to the same SaveChanges, so the appointment and its audit commit or roll back together.
            using var persist = SchedulerTelemetry.Source.StartActivity("scheduler.persist_appointment");
            var rows = await db.SaveChangesAsync(ct);
            persist?.SetTag("db.rows_affected", rows);
        }
        catch (DbUpdateException ex) when (PostgresErrorClassifier.Classify(ex)
            is PostgresFailure.BayOverlap or PostgresFailure.TechnicianOverlap or PostgresFailure.IdempotencyKeyDuplicate or PostgresFailure.Deadlock)
        {
            await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            return Refused(PostgresErrorClassifier.Classify(ex), ex, dealershipId);
        }

        await transaction.CommitAsync(ct);
        return new BookingAttempt.Confirmed(appointment, bay, technician);
    }

    private async Task AcquireLockAsync(Guid dealershipId, CancellationToken ct)
    {
        var started = clock.GetTimestamp();
        using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.acquire_dealership_lock");
        activity?.SetTag("dealership.id", dealershipId.ToString());
        await DealershipLock.AcquireAsync(db, dealershipId, ct);
        var waitedMs = clock.GetElapsedTime(started).TotalMilliseconds;
        activity?.SetTag("lock.wait_ms", waitedMs);
        SchedulerTelemetry.LockWait.Record(waitedMs, new KeyValuePair<string, object?>("dealership.id", dealershipId.ToString()));
    }

    /// <summary>The attempt for a refused insert, with its telemetry: a constraint backstop (1003) or a deadlock (1004) is never expected.</summary>
    private BookingAttempt Refused(PostgresFailure failure, DbUpdateException exception, Guid dealershipId)
    {
        switch (failure)
        {
            case PostgresFailure.BayOverlap:
                return Backstop(ProblemResources.Bay, PostgresErrorClassifier.BayConstraint);
            case PostgresFailure.TechnicianOverlap:
                return Backstop(ProblemResources.Technician, PostgresErrorClassifier.TechnicianConstraint);
            case PostgresFailure.IdempotencyKeyDuplicate:
                return new BookingAttempt.DuplicateKey();
            case PostgresFailure.Deadlock:
                SchedulerTelemetry.Deadlocks.Add(1);
                logger.DeadlockDetected(exception, dealershipId);
                return new BookingAttempt.Conflict(ProblemResources.Unknown);
            default:
                throw new UnreachableException($"{failure} is not a refusal the booking transaction answers.");
        }

        BookingAttempt Backstop(string resource, string constraint)
        {
            SchedulerTelemetry.ConstraintBackstop.Add(1, new KeyValuePair<string, object?>("constraint", constraint));
            logger.ConstraintBackstopFired(constraint, dealershipId);
            return new BookingAttempt.Conflict(resource);
        }
    }

    private async Task<(IReadOnlyList<ServiceBay> Bays, IReadOnlyList<Technician> Technicians)> QualifiedResourcesAsync(
        Guid dealershipId, ServiceType serviceType, CancellationToken ct)
    {
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealershipId && b.IsActive).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId && t.IsActive).ToListAsync(ct);
        var compatibleBays = bays.Where(b => b.Supports(serviceType)).ToList();
        var certifiedTechnicians = technicians.Where(t => t.IsCertifiedFor(serviceType)).ToList();
        if (compatibleBays.Count == 0 || certifiedTechnicians.Count == 0)
        {
            // What no active resource has at all; empty on a side that qualifies (or whose requirements exist only on separate bays).
            throw new DomainRuleViolationException(
                "no-qualified-resources",
                NoQualifiedResourcesDetail,
                new Dictionary<string, object?>
                {
                    ["missingCapabilities"] = compatibleBays.Count > 0
                        ? Array.Empty<BayCapability>()
                        : serviceType.RequiredBayCapabilities.Except(bays.SelectMany(b => b.Capabilities)).Order().ToArray(),
                    ["missingCertifications"] = certifiedTechnicians.Count > 0
                        ? Array.Empty<Certification>()
                        : serviceType.RequiredCertifications.Except(technicians.SelectMany(t => t.Certifications)).Order().ToArray(),
                });
        }

        return (compatibleBays, certifiedTechnicians);
    }

    /// <summary>
    /// Up to <c>Scheduling:SuggestedSlotCount</c> bookable starts that day nearest the requested one (ties to the earlier), from the
    /// active resources that qualify, never the requested start itself (after a backstop the calculator, which sees only this
    /// dealership's rows, would still think it free) and never a start the lead time or horizon now forbids. A snapshot, read after the
    /// transaction ended.
    /// </summary>
    private async Task<IReadOnlyList<SuggestedSlot>> SuggestAsync(Booking booking, CancellationToken ct)
    {
        var count = options.Value.SuggestedSlotCount;
        if (count == 0)
        {
            return [];
        }

        var serviceType = booking.ServiceType;
        var day = await reader.ReadAsync(booking.Dealership, booking.Window, activeOnly: true, ct);
        var bays = day.Bays.Where(b => b.IsActive && b.Supports(serviceType)).ToList();
        var technicians = day.Technicians.Where(t => t.IsActive && t.IsCertifiedFor(serviceType)).ToList();
        var busyByBay = day.Appointments.ToLookup(a => a.BayId, a => a.Slot);
        var busyByTechnician = day.Appointments.ToLookup(a => a.TechnicianId, a => a.Slot);

        IReadOnlyList<AvailabilitySlot> slots;
        using (var activity = SchedulerTelemetry.Source.StartActivity("scheduler.compute_availability"))
        {
            activity?.SetTag("availability.candidates_bays", bays.Count);
            activity?.SetTag("availability.candidates_technicians", technicians.Count);
            slots = AvailabilityCalculator.Compute(
                booking.Window,
                serviceType.Duration,
                options.Value.SlotGranularityMinutes,
                [.. bays.Select(b => new ResourceBusy(b.Id, [.. busyByBay[b.Id]]))],
                [.. technicians.Select(t => new ResourceBusy(t.Id, [.. busyByTechnician[t.Id]]))]);
            activity?.SetTag("availability.slots_returned", slots.Count);
        }

        var requestedStart = booking.Slot.StartUtc;
        var candidates = slots.Where(s => s.StartUtc != requestedStart && windowPolicy.IsBookable(s.StartUtc)).ToList();
        var zone = booking.Dealership.TimeZone;
        return [.. AvailabilityCalculator.Nearest(candidates, requestedStart, count).Select(s => new SuggestedSlot(s.StartUtc, s.EndUtc, LocalTimeConverter.FormatLocal(s.StartUtc, zone)))];
    }

    /// <summary>The stored 201 for the same request, or 422 <c>idempotency-key-reuse</c> when the key was first used for another one.</summary>
    private static BookAppointmentResult Replay(IdempotencyKey stored, string fingerprint, Activity? activity)
    {
        if (!string.Equals(stored.RequestFingerprint, fingerprint, StringComparison.Ordinal))
        {
            throw new IdempotencyKeyReuseException();
        }

        if (stored.ResponseStatus != StatusCodes.Status201Created)
        {
            throw new InvalidOperationException($"Only successful bookings are memoised, yet a stored response has status {stored.ResponseStatus}.");
        }

        var response = JsonSerializer.Deserialize(stored.ResponseBody, SchedulerJsonContext.Default.AppointmentResponse)
            ?? throw new InvalidOperationException("A stored booking response is JSON null.");
        activity?.SetTag("idempotency.replayed", true);
        activity?.SetTag("booking.bay_id", response.Bay.Id.ToString());
        activity?.SetTag("booking.technician_id", response.Technician.Id.ToString());
        return new BookAppointmentResult(response, Replayed: true);
    }

    private static bool IsLive(IdempotencyKey stored, DateTime nowUtc) => stored.ExpiresAtUtc > nowUtc;

    private DateTime Now() => ToMicroseconds(clock.GetUtcNow().UtcDateTime);

    /// <summary>Truncated to the microsecond PostgreSQL stores, so the 201 body (and its memoised copy) shows exactly the instants the database holds.</summary>
    private static DateTime ToMicroseconds(DateTime utc) => new(utc.Ticks - (utc.Ticks % 10), DateTimeKind.Utc);

    private static CustomerDetails ToCustomer(CustomerRequest customer) => new(customer.Name, customer.Email, customer.Phone);

    private static VehicleDetails ToVehicle(VehicleRequest vehicle) => new(Vin.Create(vehicle.Vin), vehicle.Registration, vehicle.Make, vehicle.Model);

    /// <summary>Everything the transaction needs, resolved and checked before it starts.</summary>
    private sealed record Booking(
        BookAppointmentCommand Command,
        string? Fingerprint,
        Dealership Dealership,
        ServiceType ServiceType,
        TimeSlot Slot,
        OperatingWindow Window,
        IReadOnlyList<ServiceBay> CompatibleBays,
        IReadOnlyList<Technician> CertifiedTechnicians,
        CustomerDetails Customer,
        VehicleDetails Vehicle);
}

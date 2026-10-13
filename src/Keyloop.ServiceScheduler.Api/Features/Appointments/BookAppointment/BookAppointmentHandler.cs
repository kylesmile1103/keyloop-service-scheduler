using System.Data;
using Keyloop.ServiceScheduler.Api.Features.Vehicles;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Validates booking rules, acquires the dealership advisory lock, allocates qualified resources, and persists the appointment with idempotency support.
/// </summary>
public sealed class BookAppointmentHandler(
    SchedulerDbContext db,
    DayScheduleReader reader,
    BookingWindowPolicy windowPolicy,
    IOptions<SchedulingOptions> options,
    TimeProvider clock,
    ILogger<BookAppointmentHandler> logger, RequirementPolicyReader policies, CurrentActor actor)
{
    /// <summary>How long a successful booking's response is replayed for its <c>Idempotency-Key</c>.</summary>
    public static readonly TimeSpan IdempotencyKeyLifetime = TimeSpan.FromHours(24);

    /// <summary>Maximum times a booking request re-resolves after finding a newer requirement policy under the dealership lock.</summary>
    private const int MaxPolicyReResolutions = 3;

    private const string NoQualifiedResourcesDetail =
        "This dealership has no active bay with every capability, or no active technician with every certification, that the service requires.";

    public async Task<BookAppointmentResult> HandleAsync(BookAppointmentCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);
        var request = command.Request;
        var key = command.IdempotencyKey;
        using var dealershipScope = logger.DealershipScope(command.DealershipId);
        using var idempotencyScope = key is null ? null : logger.IdempotencyScope(key);

        using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.book_appointment");
        activity?.SetTag("dealership.id", command.DealershipId.ToString());
        activity?.SetTag("booking.requested_start_utc", request.StartUtc.ToString("O", CultureInfo.InvariantCulture));
        var started = Stopwatch.GetTimestamp();
        var outcome = BookingOutcomes.Error;
        string? serviceCode = null;
        try
        {
            var fingerprint = key is null ? null : IdempotencyFingerprint.Compute(command.DealershipId, request);

            // Check idempotency key before lock-free rules so committed retries replay even after the booking window moves.
            if (key is not null && await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct) is { } early
                && IsLive(early, Now()))
            {
                var replay = Replay(early, fingerprint!, activity);
                outcome = BookingOutcomes.Replayed;
                return replay;
            }

            VehicleAwareInputs.EnsureHonoured(options.Value.VehicleAwareRequirements,
                ("needsLiveDiagnosis", request.NeedsLiveDiagnosis), ("vehicle.profile", request.Vehicle.Profile is not null));
            var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == command.DealershipId, ct)
                ?? throw new NotFoundException(ProblemResources.Dealership, command.DealershipId);
            var serviceType = await db.ServiceTypes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.ServiceTypeId, ct)
                ?? throw new NotFoundException(ProblemResources.ServiceType, request.ServiceTypeId);
            serviceCode = serviceType.Code;
            activity?.SetTag("service_type.code", serviceCode);

            windowPolicy.EnsureWithinHorizon(request.StartUtc);
            var slot = TimeSlot.FromStart(request.StartUtc, serviceType.Duration);
            var window = BookingWindowPolicy.OperatingWindowFor(dealership, slot);
            windowPolicy.EnsureBookable(slot.StartUtc);
            BookingWindowPolicy.EnsureAligned(slot.StartUtc, window, options.Value.SlotGranularityMinutes);
            var localDate = LocalTimeConverter.ToLocalDate(slot.StartUtc, dealership.TimeZone);
            var profile = options.Value.VehicleAwareRequirements ? VehicleProfileResolution.Resolve(Vin.Create(request.Vehicle.Vin), request.Vehicle.Profile, actor.Name) : null;
            var requirements = profile is null ? null : await policies.ResolveAsync(dealership.Id, serviceType, profile, request.NeedsLiveDiagnosis, ct);
            if (requirements is not null)
            {
                foreach (var rule in requirements.FiredRules)
                {
                    SchedulerTelemetry.RequirementRuleFired.Add(1, new KeyValuePair<string, object?>("rule", SchedulerTelemetry.RuleLabel(rule)));
                }
                activity?.SetTag("requirements.fired_rules", requirements.FiredRules.ToArray());
                var provenance = profile!.Provenance;
                foreach (var source in new[] { provenance.Powertrain, provenance.Manufacturer, provenance.VehicleClass }.Distinct())
                {
                    SchedulerTelemetry.ProfileSource.Add(1, new KeyValuePair<string, object?>("source", source.ToString()));
                }
            }
            _ = await QualifiedResourcesAsync(dealership.Id, serviceType, requirements, localDate, ct);

            // Mint appointment ID once per request so retried transactions can detect an already-committed booking.
            var booking = new Booking(
                command, fingerprint, Guid.CreateVersion7(clock.GetUtcNow()), dealership, serviceType, slot, window,
                ToCustomer(request.Customer), ToVehicle(request.Vehicle), requirements, profile, localDate);

            using var appointmentScope = logger.AppointmentScope(booking.AppointmentId);
            var duplicateKeyPasses = 0;
            var policyReResolutions = 0;
            while (true)
            {
                var attempt = await RunAsync(booking, ct);
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
                        if (await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct) is { } stored && IsLive(stored, Now()))
                        {
                            var replay = Replay(stored, fingerprint!, activity);
                            outcome = BookingOutcomes.Replayed;
                            return replay;
                        }

                        if (++duplicateKeyPasses == 2)
                        {
                            throw new InvalidOperationException("The Idempotency-Key insert failed as a duplicate twice, yet no live row has that key.");
                        }

                        continue;
                    }

                    case BookingAttempt.PolicyChanged:
                    {
                        if (++policyReResolutions > MaxPolicyReResolutions)
                        {
                            throw new BookingPolicyChurnException();
                        }

                        booking = await ReResolveAsync(booking, ct);
                        continue;
                    }

                    default:
                        throw new UnreachableException($"Unhandled booking attempt {attempt.GetType().Name}.");
                }
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
        catch (BookingPolicyChurnException)
        {
            outcome = BookingOutcomes.ConcurrencyConflict;
            throw;
        }
        finally
        {
            activity?.SetTag("booking.outcome", outcome);
            SchedulerTelemetry.BookingRequests.Add(
                1, new KeyValuePair<string, object?>("outcome", outcome));
            SchedulerTelemetry.BookingDuration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds, new KeyValuePair<string, object?>("outcome", outcome));
            if (BookingOutcomes.IsRejection(outcome))
            {
                logger.BookingRejected(outcome, command.DealershipId, serviceCode);
            }
        }
    }

    /// <summary>Executes the booking transaction under the retrying execution strategy with commit verification.</summary>
    private Task<BookingAttempt> RunAsync(Booking booking, CancellationToken ct) =>
        db.Database.CreateExecutionStrategy().ExecuteAsync(
            new BookingRun(booking),
            (_, run, token) => AttemptAsync(run, token),
            (_, run, token) => VerifyCommittedAsync(run, token),
            ct);

    /// <summary>Checks whether a transaction that failed during commit actually persisted the minted appointment.</summary>
    private async Task<ExecutionResult<BookingAttempt>> VerifyCommittedAsync(BookingRun run, CancellationToken ct)
    {
        if (!run.Committing)
        {
            return new ExecutionResult<BookingAttempt>(false, null!);
        }

        if (await FindCommittedAsync(run.Booking, ct) is not { } committed)
        {
            return new ExecutionResult<BookingAttempt>(false, null!);
        }

        if (db.DomainEvents is { } events)
        {
            await events.ResolveInDoubtCommitAsync(committed: true, ct);
        }

        return new ExecutionResult<BookingAttempt>(true, committed);
    }

    /// <summary>Returns the confirmed booking if its minted appointment exists in the database, or null.</summary>
    private async Task<BookingAttempt.Confirmed?> FindCommittedAsync(Booking booking, CancellationToken ct)
    {
        var appointment = await db.Appointments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == booking.AppointmentId, ct);
        if (appointment is null)
        {
            return null;
        }

        var bay = await db.ServiceBays.AsNoTracking().FirstAsync(b => b.Id == appointment.BayId, ct);
        var technician = await db.Technicians.AsNoTracking().FirstAsync(t => t.Id == appointment.TechnicianId, ct);
        return new BookingAttempt.Confirmed(appointment, bay, technician);
    }

    /// <summary>Executes a single attempt of the serialised booking transaction.</summary>
    private async Task<BookingAttempt> AttemptAsync(BookingRun run, CancellationToken ct)
    {
        run.Committing = false;
        var booking = run.Booking;
        db.ChangeTracker.Clear();
        var dealershipId = booking.Dealership.Id;
        var request = booking.Command.Request;

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await AcquireLockAsync(dealershipId, ct);

        // Recover if an earlier attempt committed before its acknowledgement was lost.
        var earlier = await FindCommittedAsync(booking, ct);
        if (db.DomainEvents is { } events)
        {
            await events.ResolveInDoubtCommitAsync(earlier is not null, ct);
        }

        if (earlier is not null)
        {
            await transaction.RollbackAsync(ct);
            return earlier;
        }

        var now = Now();
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
                await db.IdempotencyKeys.Where(k => k.Key == key && k.ExpiresAtUtc <= now).ExecuteDeleteAsync(ct);
            }
        }

        windowPolicy.EnsureBookable(booking.Slot.StartUtc);

        if (booking.Requirements is { } resolvedBeforeLock
            && await policies.LatestVersionAsync(dealershipId, ct) != resolvedBeforeLock.PolicyVersion)
        {
            await transaction.RollbackAsync(ct);
            return new BookingAttempt.PolicyChanged();
        }

        var (allBays, allTechnicians, compatibleBays, certifiedTechnicians) = await QualifiedResourcesAsync(
            dealershipId, booking.ServiceType, booking.Requirements, booking.LocalDate, ct);

        var (start, end) = (booking.Slot.StartUtc, booking.Slot.EndUtc);
        var busy = await db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == dealershipId && Appointment.ActiveStatuses.Contains(a.Status) && a.Slot.StartUtc < end && a.Slot.EndUtc > start)
            .Select(a => new { a.BayId, a.TechnicianId })
            .ToListAsync(ct);
        var busyBays = busy.Select(a => a.BayId).ToHashSet();
        var busyTechnicians = busy.Select(a => a.TechnicianId).ToHashSet();
        var freeBays = compatibleBays.Where(b => !busyBays.Contains(b.Id)).ToList();
        var freeTechnicians = certifiedTechnicians.Where(t => !busyTechnicians.Contains(t.Id)).ToList();
        if (freeBays.Count == 0 || freeTechnicians.Count == 0)
        {
            await transaction.RollbackAsync(ct);
            return new BookingAttempt.Unavailable();
        }

        var load = await reader.LoadCountsAsync(dealershipId, booking.Window, ct);
        ServiceBay bay;
        Technician technician;
        AllocationDecision? decision = null;
        if (booking.Requirements is { } resolved)
        {
            var allocation = AllocationPolicy.Allocate(allBays, allTechnicians, resolved, booking.LocalDate, busyBays, busyTechnicians,
                load, request.PreferredBayId, request.PreferredTechnicianId)!;
            bay = allocation.Bay;
            technician = allocation.Technician;
            decision = allocation.Decision;
            AllocationSafety.MeetsHvMinimum(technician, resolved, booking.LocalDate, booking.AppointmentId, logger);
        }
        else
        {
            bay = AllocationPolicy.ChooseBay(freeBays, booking.ServiceType, load, request.PreferredBayId)!;
            technician = AllocationPolicy.ChooseTechnician(freeTechnicians, booking.ServiceType, load, request.PreferredTechnicianId)!;
        }
        var appointment = Appointment.Book(
            booking.AppointmentId, booking.Dealership, booking.ServiceType, bay, technician, booking.Slot, booking.Window, booking.Customer,
            booking.Vehicle, request.Notes, now, booking.Requirements, booking.Profile, decision, booking.Requirements is not null && request.NeedsLiveDiagnosis);
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
            using var persist = SchedulerTelemetry.Source.StartActivity("scheduler.persist_appointment");
            var rows = await db.SaveChangesAsync(ct);
            persist?.SetTag("db.rows_affected", rows);
        }
        catch (DbUpdateException ex) when (BookingRefusal.For(PostgresErrorClassifier.Classify(ex)) is not null)
        {
            await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var refusal = BookingRefusal.For(PostgresErrorClassifier.Classify(ex))!;
            refusal.Record(ex, dealershipId, logger);
            return refusal.Attempt;
        }

        run.Committing = true;
        await transaction.CommitAsync(ct);
        return new BookingAttempt.Confirmed(appointment, bay, technician);
    }

    /// <summary>Re-resolves requirement policy and resource qualification after detecting a policy update under the lock.</summary>
    private async Task<Booking> ReResolveAsync(Booking booking, CancellationToken ct)
    {
        var requirements = await policies.ResolveAsync(booking.Dealership.Id, booking.ServiceType, booking.Profile!, booking.Command.Request.NeedsLiveDiagnosis, ct);
        _ = await QualifiedResourcesAsync(booking.Dealership.Id, booking.ServiceType, requirements, booking.LocalDate, ct);
        return booking with
        {
            Requirements = requirements,
        };
    }

    private async Task AcquireLockAsync(Guid dealershipId, CancellationToken ct)
    {
        var started = Stopwatch.GetTimestamp();
        using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.acquire_dealership_lock");
        activity?.SetTag("dealership.id", dealershipId.ToString());
        await DealershipLock.AcquireAsync(db, dealershipId, ct);
        var waitedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        activity?.SetTag("lock.wait_ms", waitedMs);
        SchedulerTelemetry.LockWait.Record(waitedMs);
    }

    private async Task<(IReadOnlyList<ServiceBay> AllBays, IReadOnlyList<Technician> AllTechnicians, IReadOnlyList<ServiceBay> Bays, IReadOnlyList<Technician> Technicians)> QualifiedResourcesAsync(
        Guid dealershipId, ServiceType serviceType, JobRequirements? requirements, DateOnly localDate, CancellationToken ct)
    {
        var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealershipId).ToListAsync(ct);
        var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealershipId).ToListAsync(ct);
        var activeBays = bays.Where(b => b.IsActive).ToArray();
        var activeTechnicians = technicians.Where(t => t.IsActive).ToArray();
        var compatibleBays = activeBays.Where(b => requirements is null ? b.Supports(serviceType) : b.Satisfies(requirements)).ToList();
        var certifiedTechnicians = activeTechnicians.Where(t => requirements is null ? t.IsCertifiedFor(serviceType) : t.Satisfies(requirements, localDate)).ToList();
        if (compatibleBays.Count == 0 || certifiedTechnicians.Count == 0)
        {
            var extensions = new Dictionary<string, object?>
            {
                ["missingCapabilities"] = compatibleBays.Count > 0 ? Array.Empty<BayCapability>()
                    : (requirements?.BayCapabilities ?? serviceType.RequiredBayCapabilities).Except(activeBays.SelectMany(b => b.Capabilities)).Order().ToArray(),
                ["missingCertifications"] = certifiedTechnicians.Count > 0 ? Array.Empty<Certification>()
                    : (requirements?.Certifications ?? serviceType.RequiredCertifications).Except(activeTechnicians.SelectMany(t => t.Certifications)).Order().ToArray(),
            };
            if (requirements is not null)
            {
                extensions["minimumHvLevel"] = requirements.MinimumHvLevel;
                extensions["requiredBrand"] = requirements.RequiredBrand;
                extensions["firedRules"] = requirements.FiredRules.ToArray();
            }
            throw new DomainRuleViolationException("no-qualified-resources", NoQualifiedResourcesDetail, extensions);
        }

        return (bays, technicians, compatibleBays, certifiedTechnicians);
    }

    /// <summary>Computes up to <c>Scheduling:SuggestedSlotCount</c> nearest bookable slots on the requested day.</summary>
    private async Task<IReadOnlyList<SuggestedSlot>> SuggestAsync(Booking booking, CancellationToken ct)
    {
        var count = options.Value.SuggestedSlotCount;
        if (count == 0)
        {
            return [];
        }

        var serviceType = booking.ServiceType;
        var day = await reader.ReadAsync(booking.Dealership, booking.Window, activeOnly: true, ct);
        var bays = day.Bays.Where(b => b.IsActive && (booking.Requirements is null ? b.Supports(serviceType) : b.Satisfies(booking.Requirements))).ToList();
        var technicians = day.Technicians.Where(t => t.IsActive && (booking.Requirements is null ? t.IsCertifiedFor(serviceType) : t.Satisfies(booking.Requirements, booking.LocalDate))).ToList();
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

    /// <summary>Returns the stored 201 response for a matching request, or throws <see cref="IdempotencyKeyReuseException"/> on payload mismatch.</summary>
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
        activity?.SetTag("service_type.code", response.ServiceType.Code);
        activity?.SetTag("idempotency.replayed", true);
        activity?.SetTag("booking.bay_id", response.Bay.Id.ToString());
        activity?.SetTag("booking.technician_id", response.Technician.Id.ToString());
        return new BookAppointmentResult(response, Replayed: true);
    }

    private static bool IsLive(IdempotencyKey stored, DateTime nowUtc) => stored.ExpiresAtUtc > nowUtc;

    private DateTime Now() => ToMicroseconds(clock.GetUtcNow().UtcDateTime);

    /// <summary>Truncates to PostgreSQL microsecond precision so returned and memoised timestamps match persisted values.</summary>
    private static DateTime ToMicroseconds(DateTime utc) => new(utc.Ticks - (utc.Ticks % 10), DateTimeKind.Utc);

    private static CustomerDetails ToCustomer(CustomerRequest customer) => new(customer.Name, customer.Email, customer.Phone);

    private static VehicleDetails ToVehicle(VehicleRequest vehicle) => new(Vin.Create(vehicle.Vin), vehicle.Registration, vehicle.Make, vehicle.Model);

    /// <summary>Pre-validated booking context passed into the transaction.</summary>
    private sealed record Booking(
        BookAppointmentCommand Command,
        string? Fingerprint,
        Guid AppointmentId,
        Dealership Dealership,
        ServiceType ServiceType,
        TimeSlot Slot,
        OperatingWindow Window,
        CustomerDetails Customer,
        VehicleDetails Vehicle,
        JobRequirements? Requirements, VehicleProfile? Profile, DateOnly LocalDate);

    /// <summary>Tracks execution strategy state across retry attempts.</summary>
    private sealed class BookingRun(Booking booking)
    {
        public Booking Booking { get; } = booking;

        public bool Committing { get; set; }
    }
}

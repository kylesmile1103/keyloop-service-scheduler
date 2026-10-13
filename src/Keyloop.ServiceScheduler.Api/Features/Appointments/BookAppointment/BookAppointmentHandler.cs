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
/// Books one appointment (ARCHITECTURE §6.3, §7.3–§7.5). In order: the <c>Idempotency-Key</c> is looked up without a lock (a retry of
/// a committed booking is replayed before any rule could reject it); the lock-free rules are checked (404s and the 422s); the
/// appointment id is minted, once per request; then one transaction at <c>READ COMMITTED</c> takes the dealership's advisory lock, looks
/// for the minted id (an earlier run of this request may have committed although its commit reported a failure), looks the key up again
/// (a concurrent request with it may have committed while this one waited; an expired row is deleted), with vehicle-aware requirements
/// confirms that the policy version it resolved is still the latest (otherwise it resolves again, ADR-029 Task 30a amendment), re-checks
/// the current roster with plain reads, re-checks availability, allocates, and inserts the appointment, its history row and the memoised response.
/// </summary>
/// <remarks>
/// <para>
/// Locks (ADR-003): the dealership lock is the only lock any booking waits for while holding nothing else. The idempotency-key row is
/// the scoped exception: the expired-key <c>DELETE</c> and the key <c>INSERT</c> can wait, but only on the same key being used at
/// another dealership at the same moment, and such a waiter holds nothing its lock holder will ever wait for, so no cycle can form.
/// An overlap the pre-check could not see (a writer outside this path) is refused by the exclusion constraints: 409
/// <c>slot-conflict</c>, counted on <c>scheduler.booking.constraint_backstop</c>.
/// </para>
/// <para>
/// Retries: the retrying execution strategy runs the transaction again after a transient failure. When the failure hit the commit,
/// it first asks whether the minted appointment exists (EF Core's <c>verifySucceeded</c>): a lost acknowledgement is then a success,
/// not a second booking, and the audit interceptor's in-doubt events are released to the observers once (by the verification when it
/// finds the appointment, otherwise by the next run's check under the lock). Only successful bookings are memoised: any refusal rolls
/// the key row back with the rest.
/// </para>
/// <para>
/// The aggregate's <c>AppointmentBooked</c> event becomes the history row inside the transaction and is logged (1001) by
/// <see cref="TelemetryDomainEventObserver"/> after the commit; refusals are logged here as 1002, a backstop as 1003, a deadlock as 1004.
/// Latencies (<c>scheduler.booking.duration</c>, <c>scheduler.booking.lock_wait</c>) are real elapsed time; business time (now, lead
/// time, horizon, key expiry) is the injected <see cref="TimeProvider"/>.
/// </para>
/// </remarks>
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

    /// <summary>
    /// How many times one request re-resolves after finding a newer policy under its lock. Each needs a separate Admin publication to
    /// commit between this request's policy read and its lock, so a request that keeps losing that race fails loudly instead of looping.
    /// </summary>
    private const int MaxPolicyReResolutions = 3;

    // The 422 detail reaches clients verbatim, so it never names individual bays or technicians (ARCHITECTURE §8.7).
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

            // 1. The key, without a lock and before every rule: a retry of a booking that committed gets the stored 201, even when time
            //    has since moved past the lead time, and never reaches the availability check, where it would meet its own appointment.
            if (key is not null && await db.IdempotencyKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct) is { } early
                && IsLive(early, Now()))
            {
                var replay = Replay(early, fingerprint!, activity);
                outcome = BookingOutcomes.Replayed;
                return replay;
            }

            // 2. The rules that need no lock: vehicle-aware inputs the configuration cannot honour, unknown ids (404), the horizon bound,
            //    opening hours, lead time, slot grid, qualified resources (422).
            VehicleAwareInputs.EnsureHonoured(options.Value.VehicleAwareRequirements,
                ("needsLiveDiagnosis", request.NeedsLiveDiagnosis), ("vehicle.profile", request.Vehicle.Profile is not null));
            var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == command.DealershipId, ct)
                ?? throw new NotFoundException(ProblemResources.Dealership, command.DealershipId);
            var serviceType = await db.ServiceTypes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.ServiceTypeId, ct)
                ?? throw new NotFoundException(ProblemResources.ServiceType, request.ServiceTypeId);
            serviceCode = serviceType.Code;
            activity?.SetTag("service_type.code", serviceCode);

            // A shape-valid UTC start can be near DateTime.MaxValue: reject it before adding duration or converting time zones.
            // Keep replay first, and hours before lead-time/alignment for starts inside the horizon.
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

            // Minted once per request, never per run: it is how a retried run recognises that an earlier run committed.
            var booking = new Booking(
                command, fingerprint, Guid.CreateVersion7(clock.GetUtcNow()), dealership, serviceType, slot, window,
                ToCustomer(request.Customer), ToVehicle(request.Vehicle), requirements, profile, localDate);

            // 3. The transaction (see the remarks). Another pass happens only when a duplicate key's stored row turns out expired, or when
            //    an Admin published a newer requirement policy while this booking waited for its lock.
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
                        // Another request committed this key just before our insert. A live row answers (replay or 422); an expired one
                        // (only possible when the instances' clocks are a day apart) is no answer: the key is free again, so book once more,
                        // and the re-check under the lock deletes the row.
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
                        // Same minted id: the rolled-back run committed nothing. A stricter version can now refuse with the 422 above.
                        if (++policyReResolutions > MaxPolicyReResolutions)
                        {
                            throw new InvalidOperationException(
                                $"The requirement policy changed under the dealership lock {policyReResolutions} times while this booking was in flight.");
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

    /// <summary>
    /// The booking transaction under the retrying execution strategy, with EF Core's commit-failure verification
    /// (<c>verifySucceeded</c>, the hook <c>ExecuteInTransactionAsync</c> is built on): after a transient failure during the commit, the
    /// strategy asks <see cref="VerifyCommittedAsync"/> before running the transaction again. <c>ExecuteInTransactionAsync</c> itself is
    /// not used because it commits whatever the operation returns, and the refusals here must roll back.
    /// </summary>
    private Task<BookingAttempt> RunAsync(Booking booking, CancellationToken ct) =>
        db.Database.CreateExecutionStrategy().ExecuteAsync(
            new BookingRun(booking),
            (_, run, token) => AttemptAsync(run, token),
            (_, run, token) => VerifyCommittedAsync(run, token),
            ct);

    /// <summary>
    /// Whether a run whose commit reported a failure committed anyway: the minted appointment exists. Only a failure after the run
    /// reached its commit can be a lost acknowledgement; an earlier one is simply retried. A found appointment settles the audit
    /// interceptor's in-doubt events (released). "Not found" settles nothing: this read takes no lock, so it may run before a commit
    /// that did happen is visible; the events stay in doubt until the next run's check under the dealership lock, which is conclusive.
    /// </summary>
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

    /// <summary>The booking if its minted appointment is in the database (with the bay and technician it holds), else null.</summary>
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

    /// <summary>One run of the booking transaction; see the class summary for the order and why it cannot double-book.</summary>
    private async Task<BookingAttempt> AttemptAsync(BookingRun run, CancellationToken ct)
    {
        // A retried run starts from nothing: what a failed run added must not be saved by this one.
        run.Committing = false;
        var booking = run.Booking;
        db.ChangeTracker.Clear();
        var now = Now();
        var dealershipId = booking.Dealership.Id;
        var request = booking.Command.Request;

        // READ COMMITTED, not REPEATABLE READ: each statement after the lock takes a fresh snapshot, so it sees what the previous
        // holder of the lock committed (a REPEATABLE READ snapshot would date from before the wait). ADR-004.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await AcquireLockAsync(dealershipId, ct);

        // Defence in depth behind the strategy's verification: if an earlier run of this request committed (its acknowledgement lost and
        // the verification inconclusive), answer with that appointment, before the key re-check would replay it as someone else's and
        // before availability would call its slot busy. It also settles that run's in-doubt events, conclusively: the earlier run held
        // this lock until its transaction ended, so its appointment is visible now if it committed (released) and never will be if not (dropped).
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

        // A policy publication commits only under this lock, so the version read here is settled until this transaction ends. A booking
        // that resolved an older version before the lock must not commit under it (ADR-029 Task 30a amendment): one plain read, no lock.
        if (booking.Requirements is { } resolvedBeforeLock
            && await policies.LatestVersionAsync(dealershipId, ct) != resolvedBeforeLock.PolicyVersion)
        {
            await transaction.RollbackAsync(ct);
            return new BookingAttempt.PolicyChanged();
        }

        // Resource writers commit under this same lock. Plain reads refresh qualification after any wait, without a second lock
        // or contended version row (ADR-003). The shared check throws exactly the early 422 and disposal rolls back this transaction.
        var (allBays, allTechnicians, compatibleBays, certifiedTechnicians) = await QualifiedResourcesAsync(
            dealershipId, booking.ServiceType, booking.Requirements, booking.LocalDate, ct);

        // The pre-check: active appointments of this dealership overlapping the slot (half-open), as of the previous holder's commit.
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
            // The interceptor adds the history row to the same SaveChanges, so the appointment and its audit commit or roll back together.
            using var persist = SchedulerTelemetry.Source.StartActivity("scheduler.persist_appointment");
            var rows = await db.SaveChangesAsync(ct);
            persist?.SetTag("db.rows_affected", rows);
        }
        catch (DbUpdateException ex) when (BookingRefusal.For(PostgresErrorClassifier.Classify(ex)) is not null)
        {
            // Answered here, never handed to the strategy: even a 40P01, which the strategy would retry as transient.
            await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var refusal = BookingRefusal.For(PostgresErrorClassifier.Classify(ex))!;
            refusal.Record(ex, dealershipId, logger);
            return refusal.Attempt;
        }

        // From here a failure may be a lost acknowledgement of a commit that happened: VerifyCommittedAsync finds out.
        run.Committing = true;
        await transaction.CommitAsync(ct);
        return new BookingAttempt.Confirmed(appointment, bay, technician);
    }

    /// <summary>
    /// The booking again with the dealership's current policy and roster, after a run found a newer policy under its lock. Lock-free reads,
    /// as before the first run; it throws the same <c>no-qualified-resources</c> 422 when the new version leaves nobody qualified.
    /// </summary>
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
        activity?.SetTag("service_type.code", response.ServiceType.Code);
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
        Guid AppointmentId,
        Dealership Dealership,
        ServiceType ServiceType,
        TimeSlot Slot,
        OperatingWindow Window,
        CustomerDetails Customer,
        VehicleDetails Vehicle,
        JobRequirements? Requirements, VehicleProfile? Profile, DateOnly LocalDate);

    /// <summary>The execution strategy's state across runs: whether the current run had reached its commit when it failed.</summary>
    private sealed class BookingRun(Booking booking)
    {
        public Booking Booking { get; } = booking;

        public bool Committing { get; set; }
    }
}

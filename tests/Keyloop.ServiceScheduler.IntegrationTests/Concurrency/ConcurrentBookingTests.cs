using System.Globalization;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Microsoft.AspNetCore.Hosting;
using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Keyloop.ServiceScheduler.IntegrationTests.Concurrency;

/// <summary>
/// The adversarial concurrency proof (ARCHITECTURE §7.3, §14.4; the brief's acceptance criterion). Thirty distinct requests for the
/// same slot on a dealership with exactly one qualifying bay and one qualifying technician (<see cref="TestData.ContentionDealershipAsync"/>:
/// <c>EV-BATTERY-CHECK</c>, 60 minutes) are released at once through the in-memory test server against real PostgreSQL. Exactly one is
/// booked; the other 29 are answered <c>409</c> with suggestions; nothing fails, deadlocks, trips the exclusion-constraint backstop or
/// leaves an orphaned audit, idempotency or notification outbox row, and the winner's confirmation email is staged exactly once. The
/// variants show that the lock serialises without refusing legitimate work, that queued requests record the real time they waited, and
/// that one dealership's queue never delays another's bookings. Every request carries a deliverable (non-reserved) address, so each
/// confirmation takes the production <c>Pending</c> outbox path, not the <c>Suppressed</c> one reserved-domain customers take.
/// </summary>
/// <remarks>
/// The assertions are the design's claims, not tolerances: a failure here is a design defect to investigate (the
/// <c>scheduler.booking.lock_wait</c> histogram, PostgreSQL's logs), never a reason to loosen them. Before asserting, every run writes
/// its responses by status and problem type, the booking outcome counter, the deadlock and backstop counters and the lock-wait
/// distribution to the test output (shown with <c>--output Detailed --show-test-results all</c>). Each round runs on a fresh host
/// and a reset database; the integration tests run one at a time, so the metrics and logs collected belong to this test alone.
/// </remarks>
public sealed class ConcurrentBookingTests(PostgresFixture pg) : IAsyncLifetime
{
    private const int Contenders = 30;

    /// <summary>11:00 BST on the booking day: the slot every contender asks for.</summary>
    private static readonly DateTime Ten = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    /// <summary>How long the queued tests keep the dealership's lock once every contender is waiting for it.</summary>
    private static readonly TimeSpan LockHold = TimeSpan.FromMilliseconds(250);

    /// <summary>The queued contenders' lower bound on <c>lock_wait</c>: <see cref="LockHold"/> less scheduling slack.</summary>
    private const double QueuedLockWaitFloorMs = 200;

    /// <summary>The ceiling on another dealership's <c>lock_wait</c> while one dealership's lock is contended (the brief's 50 ms).</summary>
    private const double UncontendedLockWaitCeilingMs = 50;

    private CapturingLoggerProvider _logs = null!;
    private MetricsCollector _metrics = null!;
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _logs = new CapturingLoggerProvider();
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock(), _logs);
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
        _metrics = new MetricsCollector();
    }

    public async ValueTask DisposeAsync()
    {
        _metrics.Dispose();
        _client.Dispose();
        await _factory.DisposeAsync();
        _logs.Dispose();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task Exactly_one_of_thirty_simultaneous_bookings_succeeds(int round)
    {
        var (dealershipId, serviceTypeId, bayId, technicianId) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);

        // Every contender is a distinct request (its own customer, deliverable address and VIN). Odd rounds send no Idempotency-Key, as
        // a plain client would; in even rounds each contender sends its own, so the keyed path runs under the same contention and "no
        // orphaned idempotency row" is a claim that can fail: the winner's key must be the only one memoised, pointing at the winner, and
        // the 29 losers' keys must have rolled back with their refusals (ARCHITECTURE §7.5). Rounds rather than mixed traffic: a keyed
        // request makes one more round trip before the lock (the lock-free key lookup), so in a mixed crowd an unkeyed request nearly
        // always wins.
        var keyed = round % 2 == 0;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var contenders = Enumerable.Range(1, Contenders).Select(async contender =>
        {
            var request = Request(serviceTypeId, Ten, contender);
            var key = keyed ? IdempotencyKeyFor(string.Create(CultureInfo.InvariantCulture, $"round-{round}"), contender) : null;
            await gate.Task;
            return await BookAsync(dealershipId, contender, request, key);
        }).ToArray();
        gate.SetResult();
        var outcomes = await Task.WhenAll(contenders);
        Diagnose($"round {round}", outcomes, dealershipId);

        var winner = await ShouldHaveExactlyOneWinnerAsync(outcomes, dealershipId, bayId, technicianId, Ten, $"round {round}");
        (winner.IdempotencyKey is not null).ShouldBe(keyed);

        // The lock made the pre-check authoritative: every loser was refused by it, none by the constraint or a deadlock.
        ShouldHaveNoDeadlockOrBackstop();
        Outcomes(dealershipId).ShouldBe(new Dictionary<string, long> { ["confirmed"] = 1, ["slot_unavailable"] = Contenders - 1 }, ignoreOrder: true);
        var lockWaits = LockWaits(dealershipId);
        lockWaits.Count.ShouldBe(Contenders, "every contender passed the lock-free rules and queued for the dealership's lock");
        lockWaits.ShouldAllBe(wait => wait > 0, "lock_wait is real elapsed time (Stopwatch), not the frozen business clock");

        ShouldHaveCleanLogs(confirmed: 1, rejected: Contenders - 1);
        await ShouldHaveExactlyTheWinnerInTheDatabaseAsync(dealershipId, winner);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Vehicle_aware_HV_and_mixed_powertrain_rounds_keep_exactly_one_winner(bool mixed)
    {
        var site = TestData.NewDealership("Vehicle contention");
        var bay = TestData.NewBay(site.Id, "Standard", BayCapability.StandardLift);
        var technician = TestData.NewTechnician(site.Id, "HV trained", "HV", Certification.GeneralService);
        technician.SetCompetence(2, TestData.BookingDay, confirmed: false);
        var unqualified = TestData.NewTechnician(site.Id, "A unqualified preferred technician", "ICE", Certification.GeneralService);
        var service = TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        await _factory.WithDbAsync(async db =>
        {
            db.AddRange(site, bay, technician, service);
            if (!mixed)
            {
                db.Add(unqualified);
            }
            await db.SaveChangesAsync(Ct);
        });
        using var host = _factory.WithWebHostBuilder(b => b.UseSetting("Scheduling:VehicleAwareRequirements", "true"));
        _client.Dispose();
        _client = host.CreateClient();
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var contenders = Enumerable.Range(1, Contenders).Select(async contender =>
        {
            var powertrain = mixed ? (contender % 3) switch { 0 => Powertrain.Ice, 1 => Powertrain.BatteryElectric, _ => Powertrain.Unknown } : Powertrain.BatteryElectric;
            var request = Request(service.Id, Ten, contender);
            request = request with
            {
                PreferredTechnicianId = mixed ? null : unqualified.Id,
                Vehicle = request.Vehicle with { Profile = powertrain == Powertrain.Unknown ? null : new VehicleProfileRequest(powertrain, DeclarationReason: "Verified at intake") },
            };
            await gate.Task;
            return await BookAsync(site.Id, contender, request, IdempotencyKeyFor(mixed ? "mixed" : "hv", contender));
        }).ToArray();
        gate.SetResult();
        var outcomes = await Task.WhenAll(contenders);
        Diagnose(mixed ? "mixed powertrains" : "HV contention", outcomes, site.Id);
        var winner = await ShouldHaveExactlyOneWinnerAsync(outcomes, site.Id, bay.Id, technician.Id, Ten, "vehicle aware");
        var decision = winner.Appointment!.Allocation.ShouldNotBeNull();
        decision.MinimumHvLevel.ShouldBe(mixed && winner.Contender % 3 == 0 ? 0 : 2);
        if (!mixed)
        {
            decision.Reasons.ShouldContain("preferred-technician:minimum-hv-level");
        }
        ShouldHaveNoDeadlockOrBackstop();
        _metrics.Sum("scheduler.allocation.below_hv_minimum").ShouldBe(0);
        _metrics.Sum("scheduler.allocation.decided_by").ShouldBe(1);
        Outcomes(site.Id).ShouldBe(new Dictionary<string, long> { ["confirmed"] = 1, ["slot_unavailable"] = Contenders - 1 }, ignoreOrder: true);
        var waits = LockWaits(site.Id);
        waits.Count.ShouldBe(Contenders);
        waits.ShouldAllBe(wait => wait > 0);
        ShouldHaveCleanLogs(confirmed: 1, rejected: Contenders - 1);
        await ShouldHaveExactlyTheWinnerInTheDatabaseAsync(site.Id, winner);
    }

    [Fact]
    public async Task Thirty_bookings_for_different_slots_all_succeed()
    {
        // One bay, one technician and a 15-minute service: the 07:00Z–17:00Z window (08:00–18:00 BST) holds 40 slots, so 30 requests
        // for 30 different slots are all bookable. Serialising them on the dealership's lock must not refuse any of them.
        var (dealershipId, _, bayId, technicianId) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var quickCheck = TestData.NewServiceType("EV-QUICK-CHECK", 15, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        await _factory.WithDbAsync(async db =>
        {
            db.Add(quickCheck);
            await db.SaveChangesAsync(Ct);
        });
        var opening = TestData.LondonTime(8);
        var startFor = Enumerable.Range(1, Contenders).ToDictionary(contender => contender, contender => opening.AddMinutes(15 * (contender - 1)));

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var contenders = startFor.Select(async pair =>
        {
            var request = Request(quickCheck.Id, pair.Value, pair.Key);
            await gate.Task;
            return await BookAsync(dealershipId, pair.Key, request, key: null);
        }).ToArray();
        gate.SetResult();
        var outcomes = await Task.WhenAll(contenders);
        Diagnose("distinct slots", outcomes, dealershipId);

        outcomes.Count(o => o.Status == HttpStatusCode.Created).ShouldBe(Contenders, Tally(outcomes));
        foreach (var outcome in outcomes)
        {
            var appointment = outcome.Appointment.ShouldNotBeNull(outcome.Body);
            outcome.Location.ShouldBe($"/api/v1/appointments/{appointment.Id}");
            (appointment.StartUtc, appointment.EndUtc).ShouldBe((startFor[outcome.Contender], startFor[outcome.Contender].AddMinutes(15)));
            (appointment.Bay.Id, appointment.Technician.Id).ShouldBe((bayId, technicianId));
            appointment.Vehicle.Vin.ShouldBe(TestData.VinFor(outcome.Contender), "each 201 describes its own request");
        }

        ShouldHaveNoDeadlockOrBackstop();
        Outcomes(dealershipId).ShouldBe(new Dictionary<string, long> { ["confirmed"] = Contenders });
        var lockWaits = LockWaits(dealershipId);
        lockWaits.Count.ShouldBe(Contenders);
        ShouldHaveCleanLogs(confirmed: Contenders, rejected: 0);

        var booked = outcomes.Select(o => o.Appointment!.Id).ToHashSet();
        await _factory.WithDbAsync(async db =>
        {
            var rows = await db.Appointments.AsNoTracking().Where(a => a.DealershipId == dealershipId).OrderBy(a => a.Slot.StartUtc).ToListAsync(Ct);
            rows.Select(a => a.Id).ShouldBe(booked, ignoreOrder: true);
            rows.ShouldAllBe(a => a.Status == AppointmentStatus.Confirmed && a.BayId == bayId && a.TechnicianId == technicianId);
            rows.Select(a => a.Slot.StartUtc).ShouldBe(startFor.Values.Order());
            rows.Zip(rows.Skip(1)).ShouldAllBe(pair => pair.First.Slot.EndUtc <= pair.Second.Slot.StartUtc, "half-open, back to back, never overlapping");

            var history = await db.AppointmentHistory.AsNoTracking().ToListAsync(Ct);
            history.Select(h => h.AppointmentId).ShouldBe(booked, ignoreOrder: true, "exactly one audit row per booking");
            history.ShouldAllBe(h => h.EventType == "Booked");
            (await db.IdempotencyKeys.CountAsync(Ct)).ShouldBe(0, "no Idempotency-Key was sent");

            // ADR-020: each booking staged its confirmation in its own transaction, once, while thirty transactions queued on the lock.
            var outbox = await db.NotificationOutbox.AsNoTracking().ToListAsync(Ct);
            outbox.Select(n => n.AppointmentId).ShouldBe(booked, ignoreOrder: true, "exactly one outbox row per booking");
            outbox.ShouldAllBe(n => n.Kind == NotificationKind.BookingConfirmation);
            outbox.Select(n => n.Recipient).ShouldBe(outcomes.Select(o => TestData.DeliverableEmail(o.Contender)), ignoreOrder: true);
            outbox.ShouldAllBe(n => n.Status == NotificationStatus.Pending && n.Attempts == 0 && n.LastFailure == null,
                "deliverable addresses are staged on the production Pending path, and dispatch is off in SystemTest");
        });
    }

    [Fact]
    public async Task Contenders_queued_behind_the_dealership_lock_record_the_time_they_waited()
    {
        // The test holds the dealership's lock, so all thirty pass the lock-free rules and queue for it at once; released together, they
        // still book exactly once. Each records at least the time the test held the lock (Stopwatch, not the frozen business clock).
        var (dealershipId, serviceTypeId, bayId, technicianId) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        Task<Outcome>[] contenders;
        int completedWhileLocked;
        await using (var holder = await HoldDealershipLockAsync(dealershipId))
        {
            contenders = [.. Enumerable.Range(1, Contenders).Select(contender =>
                BookAsync(dealershipId, contender, Request(serviceTypeId, Ten, contender), IdempotencyKeyFor("queued", contender)))];
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, Contenders, Ct);
            await Task.Delay(LockHold, Ct);
            completedWhileLocked = contenders.Count(c => c.IsCompleted);
            await holder.CommitAsync(Ct);
        }

        var outcomes = await Task.WhenAll(contenders);
        Diagnose("queued", outcomes, dealershipId);

        completedWhileLocked.ShouldBe(0, "no booking can complete while its dealership's lock is held elsewhere");
        var winner = await ShouldHaveExactlyOneWinnerAsync(outcomes, dealershipId, bayId, technicianId, Ten, "queued");
        ShouldHaveNoDeadlockOrBackstop();
        Outcomes(dealershipId).ShouldBe(new Dictionary<string, long> { ["confirmed"] = 1, ["slot_unavailable"] = Contenders - 1 }, ignoreOrder: true);
        var lockWaits = LockWaits(dealershipId);
        lockWaits.Count.ShouldBe(Contenders);
        lockWaits.ShouldAllBe(wait => wait >= QueuedLockWaitFloorMs, $"each contender queued for at least the {LockHold.TotalMilliseconds} ms the test held the lock");
        ShouldHaveCleanLogs(confirmed: 1, rejected: Contenders - 1);
        await ShouldHaveExactlyTheWinnerInTheDatabaseAsync(dealershipId, winner);
    }

    [Fact]
    public async Task Two_dealerships_do_not_contend()
    {
        // Dealership A is hammered: thirty contenders for one slot, all queued behind A's lock, which the test holds. Dealership B takes
        // its own lock, so it books at once (lock_wait under 50 ms) while not one of A's requests can make progress.
        var (dealershipA, serviceTypeId, bayA, technicianA) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var dealershipB = TestData.NewDealership("Second Motors");
        var bayB = TestData.NewBay(dealershipB.Id, "EV Bay", BayCapability.EvHighVoltage);
        var technicianB = TestData.NewTechnician(dealershipB.Id, "Chloe Dubois", "S-0001", Certification.HighVoltageElectrical);
        await _factory.WithDbAsync(async db =>
        {
            db.AddRange(dealershipB, bayB, technicianB);
            await db.SaveChangesAsync(Ct);
        });
        DealershipLock.KeyFor(dealershipB.Id).ShouldNotBe(DealershipLock.KeyFor(dealershipA), "distinct dealerships have distinct lock keys");
        DateTime[] startsAtB = [Ten, Ten.AddHours(1), Ten.AddHours(2)];

        Task<Outcome>[] contendersAtA;
        var bookingsAtB = new List<Outcome>();
        Task<Outcome>? stuckAtB = null;
        int completedAtAWhileBBooked;
        await using (var holder = await HoldDealershipLockAsync(dealershipA))
        {
            contendersAtA = [.. Enumerable.Range(1, Contenders).Select(contender =>
                BookAsync(dealershipA, contender, Request(serviceTypeId, Ten, contender), key: null))];
            await DatabaseProbe.WaitForBlockedSessionsAsync(pg.ConnectionString, Contenders, Ct);

            // One at a time: concurrent bookings at B would (rightly) queue for B's own lock and blur what is measured.
            foreach (var (start, index) in startsAtB.Select((start, index) => (start, index)))
            {
                var contender = 101 + index;
                var booking = BookAsync(dealershipB.Id, contender, Request(serviceTypeId, start, contender), key: null);
                if (await Task.WhenAny(booking, Task.Delay(TimeSpan.FromSeconds(10), Ct)) != booking)
                {
                    stuckAtB = booking;
                    break;
                }

                bookingsAtB.Add(await booking);
            }

            completedAtAWhileBBooked = contendersAtA.Count(c => c.IsCompleted);
            await Task.Delay(LockHold, Ct);
            await holder.CommitAsync(Ct);
        }

        var outcomesAtA = await Task.WhenAll(contendersAtA);
        if (stuckAtB is not null)
        {
            bookingsAtB.Add(await stuckAtB);
        }

        Diagnose("dealership A", outcomesAtA, dealershipA);
        Diagnose("dealership B while A was locked", bookingsAtB, dealershipB.Id);
        (stuckAtB is null).ShouldBeTrue("a booking at B did not complete within 10 s while A's lock was held: it queued behind A");
        completedAtAWhileBBooked.ShouldBe(0, "A's contenders were all still queued behind A's lock while B booked");
        bookingsAtB.ShouldAllBe(o => o.Status == HttpStatusCode.Created, Tally(bookingsAtB));
        bookingsAtB.Select(o => o.Appointment!.Bay.Id).Distinct().ShouldBe([bayB.Id]);
        var lockWaitsAtB = LockWaits(dealershipB.Id);
        lockWaitsAtB.Count.ShouldBe(startsAtB.Length);
        lockWaitsAtB.Max().ShouldBeLessThan(UncontendedLockWaitCeilingMs, "B's lock is not A's: B never queues behind A's thirty");

        var winner = await ShouldHaveExactlyOneWinnerAsync(outcomesAtA, dealershipA, bayA, technicianA, Ten, "dealership A");
        var lockWaitsAtA = LockWaits(dealershipA);
        lockWaitsAtA.Count.ShouldBe(Contenders);
        lockWaitsAtA.ShouldAllBe(wait => wait >= QueuedLockWaitFloorMs);
        ShouldHaveNoDeadlockOrBackstop();
        Outcomes(dealershipA).ShouldBe(new Dictionary<string, long> { ["confirmed"] = 1, ["slot_unavailable"] = Contenders - 1 }, ignoreOrder: true);
        Outcomes(dealershipB.Id).ShouldBe(new Dictionary<string, long> { ["confirmed"] = startsAtB.Length });
        ShouldHaveCleanLogs(confirmed: 1 + startsAtB.Length, rejected: Contenders - 1);
        await ShouldHaveExactlyTheWinnerInTheDatabaseAsync(dealershipA, winner);
        await _factory.WithDbAsync(async db =>
            (await db.Appointments.CountAsync(a => a.DealershipId == dealershipB.Id && a.Status == AppointmentStatus.Confirmed, Ct)).ShouldBe(startsAtB.Length));
    }

    /// <summary>
    /// ARCHITECTURE §14.4 assertions 1–3 on the responses: one <c>201</c> for the requested slot on the only bay and technician, whose
    /// <c>Location</c> names the booked id and resolves (a <c>GET</c> of it, once the contention is over, answers <c>200</c> with the
    /// same body) and whose body is the winner's own request; twenty-nine <c>409</c> problems (<c>slot-unavailable</c> or
    /// <c>slot-conflict</c>), each with its own <c>traceId</c> and a non-empty <c>suggestedSlots</c> that never offers the requested
    /// start; no <c>5xx</c>; nothing replayed.
    /// </summary>
    private async Task<Outcome> ShouldHaveExactlyOneWinnerAsync(
        IReadOnlyList<Outcome> outcomes, Guid dealershipId, Guid bayId, Guid technicianId, DateTime start, string context)
    {
        var tally = $"{context}: {Tally(outcomes)}";
        outcomes.Count.ShouldBe(Contenders);
        outcomes.Count(o => o.Status == HttpStatusCode.Created).ShouldBe(1, tally);
        outcomes.Count(o => o.Status == HttpStatusCode.Conflict).ShouldBe(Contenders - 1, tally);
        outcomes.Count(o => (int)o.Status >= 500).ShouldBe(0, tally);
        outcomes.ShouldNotContain(o => o.Replayed, "distinct requests with distinct keys: nothing to replay");

        var winner = outcomes.Single(o => o.Status == HttpStatusCode.Created);
        var appointment = winner.Appointment.ShouldNotBeNull(winner.Body);
        winner.Location.ShouldBe($"/api/v1/appointments/{appointment.Id}");
        appointment.DealershipId.ShouldBe(dealershipId);
        (appointment.Bay.Id, appointment.Technician.Id).ShouldBe((bayId, technicianId));
        (appointment.StartUtc, appointment.EndUtc).ShouldBe((start, start.AddHours(1)));
        appointment.Status.ShouldBe(AppointmentStatus.Confirmed);
        appointment.Vehicle.Vin.ShouldBe(TestData.VinFor(winner.Contender), "the 201 describes the winner's own request");
        appointment.Customer.Email.ShouldBe(TestData.DeliverableEmail(winner.Contender), "the winner's own, deliverable address");

        var traceIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var loser in outcomes.Where(o => o.Status == HttpStatusCode.Conflict))
        {
            loser.MediaType.ShouldBe("application/problem+json", loser.Body);
            var problem = loser.Problem.ShouldNotBeNull(loser.Body);
            problem.GetProperty("type").GetString().ShouldBeOneOf(ProblemTypes.SlotUnavailable, ProblemTypes.SlotConflict);
            problem.GetProperty("status").GetInt32().ShouldBe(StatusCodes.Status409Conflict);
            problem.GetProperty("instance").GetString().ShouldBe(Url(dealershipId));
            var traceId = problem.GetProperty("traceId").GetString().ShouldNotBeNull(loser.Body);
            traceId.ShouldMatch("^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$");
            traceIds.Add(traceId).ShouldBeTrue("each refusal carries its own request's trace id");
            var suggested = problem.GetProperty("suggestedSlots").EnumerateArray()
                .Select(slot => slot.GetProperty("startUtc").GetDateTime().ToUniversalTime()).ToList();
            suggested.ShouldNotBeEmpty(loser.Body);
            suggested.ShouldNotContain(start, "the requested slot itself is never suggested");
        }

        // Assertion 1, "Location resolves": followed as a client follows it, it reads back exactly what the 201 answered.
        using var resolved = await _client.GetAsync(winner.Location, Ct);
        var resolvedBody = await resolved.Content.ReadAsStringAsync(Ct);
        resolved.StatusCode.ShouldBe(HttpStatusCode.OK, $"{context}: GET {winner.Location}: {resolvedBody}");
        resolvedBody.ShouldBe(winner.Body, $"{context}: GET {winner.Location} answers the winner's 201 body");
        return winner;
    }

    /// <summary>
    /// ARCHITECTURE §14.4 assertion 4: the winner is the dealership's only appointment, active, on the only bay and technician, with
    /// exactly one audit row; no audit row references a missing appointment; the only idempotency row (if any) is the winner's; the
    /// winner's booking confirmation is the dealership's only notification outbox row (ADR-020, proposal item A5), staged
    /// <c>Pending</c> for its deliverable address and untouched by a dispatcher.
    /// </summary>
    private Task ShouldHaveExactlyTheWinnerInTheDatabaseAsync(Guid dealershipId, Outcome winner) => _factory.WithDbAsync(async db =>
    {
        var booked = winner.Appointment!;
        var active = await db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == dealershipId && Appointment.ActiveStatuses.Contains(a.Status)).ToListAsync(Ct);
        var row = active.ShouldHaveSingleItem();
        row.Id.ShouldBe(booked.Id);
        (row.BayId, row.TechnicianId, row.Slot).ShouldBe((booked.Bay.Id, booked.Technician.Id, TimeSlot.Create(booked.StartUtc, booked.EndUtc)));
        (await db.Appointments.CountAsync(a => a.DealershipId == dealershipId, Ct)).ShouldBe(1, "the losers left no row in any status");

        var history = await db.AppointmentHistory.AsNoTracking()
            .Where(h => db.Appointments.Any(a => a.Id == h.AppointmentId && a.DealershipId == dealershipId)).ToListAsync(Ct);
        var entry = history.ShouldHaveSingleItem();
        (entry.AppointmentId, entry.EventType).ShouldBe((booked.Id, "Booked"));
        (await db.AppointmentHistory.CountAsync(h => !db.Appointments.Any(a => a.Id == h.AppointmentId), Ct)).ShouldBe(0, "orphaned history");

        // The confirmation email is staged in the winner's transaction (ADR-020): exactly one outbox row, the winner's, addressed to the
        // winner's customer; the 29 refusals rolled back before staging anything, and nothing was staged twice. The address is
        // deliverable, so the row takes the production path a dispatcher would claim: Pending, never Suppressed (dispatch is off in
        // SystemTest, so nothing has claimed or attempted it).
        var outbox = await db.NotificationOutbox.AsNoTracking()
            .Where(n => db.Appointments.Any(a => a.Id == n.AppointmentId && a.DealershipId == dealershipId)).ToListAsync(Ct);
        var notification = outbox.ShouldHaveSingleItem("exactly one confirmation is staged, for the winner");
        (notification.AppointmentId, notification.Kind, notification.Recipient).ShouldBe((booked.Id, NotificationKind.BookingConfirmation, booked.Customer.Email));
        notification.Status.ShouldBe(NotificationStatus.Pending, "a deliverable address is staged on the production Pending path");
        (notification.Attempts, notification.ClaimToken, notification.LastFailure).ShouldBe((0, (Guid?)null, (string?)null));
        notification.ReadSnapshot().AppointmentId.ShouldBe(booked.Id);
        (await db.NotificationOutbox.CountAsync(n => !db.Appointments.Any(a => a.Id == n.AppointmentId), Ct)).ShouldBe(0, "orphaned outbox rows");

        (await db.IdempotencyKeys.CountAsync(k => k.ResourceId != null && !db.Appointments.Any(a => a.Id == k.ResourceId), Ct)).ShouldBe(0, "orphaned idempotency rows");
        var keys = await db.IdempotencyKeys.AsNoTracking().ToListAsync(Ct);
        if (winner.IdempotencyKey is null)
        {
            keys.ShouldBeEmpty("only a successful booking is memoised, and the winner sent no key");
        }
        else
        {
            var key = keys.ShouldHaveSingleItem("only the winner's key is memoised; the losers' rolled back with their refusals");
            (key.Key, key.ResourceId, key.ResponseStatus).ShouldBe((winner.IdempotencyKey, booked.Id, StatusCodes.Status201Created));
        }
    });

    private void ShouldHaveNoDeadlockOrBackstop()
    {
        _metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0, "ADR-003: a booking takes one lock, so no cycle can form");
        _metrics.Sum("scheduler.booking.constraint_backstop").ShouldBe(0, "the lock makes the exclusion constraints a pure backstop");
    }

    /// <summary>
    /// No entry at Error or above, no 1004 DeadlockDetected and no 1003 ConstraintBackstopFired anywhere in the host's life;
    /// <paramref name="confirmed"/> 1001 BookingConfirmed and <paramref name="rejected"/> 1002 BookingRejected from the scheduler.
    /// </summary>
    private void ShouldHaveCleanLogs(int confirmed, int rejected)
    {
        var entries = _logs.Entries;
        var errors = entries.Where(e => e.Level >= LogLevel.Error).ToList();
        errors.ShouldBeEmpty(string.Join(Environment.NewLine, errors.Select(e => $"{e.Level} {e.Category} {e.EventId}: {e.Message} {e.Exception}")));
        entries.ShouldNotContain(e => e.EventId.Id == 1004, "DeadlockDetected");
        entries.ShouldNotContain(e => e.EventId.Id == 1003, "ConstraintBackstopFired");
        var scheduler = entries.Where(e => e.Category.StartsWith("Keyloop.ServiceScheduler", StringComparison.Ordinal)).ToList();
        scheduler.Count(e => e.EventId.Id == 1001).ShouldBe(confirmed, "BookingConfirmed, once per committed booking");
        scheduler.Count(e => e.EventId.Id == 1002).ShouldBe(rejected, "BookingRejected, once per refusal");
    }

    private Dictionary<string, long> Outcomes(Guid dealershipId) =>
        _metrics.Of("scheduler.booking.requests", MetricsCollector.Tag("dealership.id", dealershipId))
            .GroupBy(m => (string)m.Tag("outcome")!)
            .ToDictionary(g => g.Key, g => (long)g.Sum(m => m.Value));

    private List<double> LockWaits(Guid dealershipId) =>
        [.. _metrics.Of("scheduler.booking.lock_wait", MetricsCollector.Tag("dealership.id", dealershipId)).Select(m => m.Value)];

    /// <summary>
    /// Writes what a run produced to the test output before anything is asserted, so a failing run carries the evidence to investigate
    /// it with: the responses by status and problem type, the booking outcome counter, the deadlock and backstop counters, and the
    /// dealership's <c>scheduler.booking.lock_wait</c> distribution (also the evidence of real queueing on a passing run).
    /// </summary>
    private void Diagnose(string label, IReadOnlyList<Outcome> outcomes, Guid dealershipId)
    {
        var waits = LockWaits(dealershipId).Order().ToList();
        var distribution = waits.Count == 0
            ? "none"
            : string.Create(CultureInfo.InvariantCulture, $"n={waits.Count} min={waits[0]:F1} p50={waits[waits.Count / 2]:F1} max={waits[^1]:F1} sum={waits.Sum():F1} ms");
        var counted = string.Join(", ", Outcomes(dealershipId)
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => string.Create(CultureInfo.InvariantCulture, $"{pair.Key}={pair.Value}")));
        TestContext.Current.TestOutputHelper?.WriteLine(string.Create(
            CultureInfo.InvariantCulture,
            $"{label}: responses [{Tally(outcomes)}]; scheduler.booking.requests [{counted}]; deadlocks={_metrics.Sum("scheduler.booking.deadlocks")}, constraint_backstop={_metrics.Sum("scheduler.booking.constraint_backstop")}; lock_wait {distribution}"));
    }

    /// <summary>The responses by status and problem slug, e.g. <c>1 x 201, 29 x 409 slot-unavailable</c>, for assertion messages.</summary>
    private static string Tally(IEnumerable<Outcome> outcomes) =>
        string.Join(", ", outcomes
            .GroupBy(o => (Status: (int)o.Status, Slug: ProblemSlug(o)))
            .OrderBy(g => g.Key.Status)
            .ThenBy(g => g.Key.Slug, StringComparer.Ordinal)
            .Select(g => string.Create(CultureInfo.InvariantCulture, $"{g.Count()} x {g.Key.Status}{(g.Key.Slug is null ? "" : " " + g.Key.Slug)}")));

    private static string? ProblemSlug(Outcome outcome) =>
        outcome.Problem is { } problem && problem.TryGetProperty("type", out var type) && type.GetString() is { } uri
            ? uri.Replace(ProblemTypes.Base, "", StringComparison.Ordinal)
            : null;

    /// <summary>
    /// The contender's booking body with its own deliverable address (<see cref="TestData.DeliverableEmail"/>): a reserved-domain
    /// customer's confirmation is staged <c>Suppressed</c>, so only a deliverable one exercises the outbox row a dispatcher would claim.
    /// </summary>
    private static BookAppointmentRequest Request(Guid serviceTypeId, DateTime startUtc, int contender) =>
        TestData.BookingRequest(serviceTypeId, startUtc, customerIndex: contender, email: TestData.DeliverableEmail(contender));

    /// <summary>A distinct, valid <c>Idempotency-Key</c> (1–64 of <c>[A-Za-z0-9_-]</c>) per contender, e.g. <c>round-2-contender-07</c>.</summary>
    private static string IdempotencyKeyFor(string scope, int contender) => string.Create(CultureInfo.InvariantCulture, $"{scope}-contender-{contender:D2}");

    private static string Url(Guid dealershipId) => $"/api/v1/dealerships/{dealershipId}/appointments";

    /// <summary>Posts one booking and reads its answer inside the contender's own task, so the thirty run end to end concurrently.</summary>
    private async Task<Outcome> BookAsync(Guid dealershipId, int contender, BookAppointmentRequest request, string? key)
    {
        using var response = await _client.PostJsonAsync(
            Url(dealershipId), request, SchedulerJsonContext.Default.BookAppointmentRequest,
            key is null ? null : new Dictionary<string, string> { ["Idempotency-Key"] = key }, Ct);
        var body = await response.Content.ReadAsStringAsync(Ct);
        var mediaType = response.Content.Headers.ContentType?.MediaType;
        AppointmentResponse? appointment = null;
        JsonElement? problem = null;
        if (response.StatusCode == HttpStatusCode.Created && mediaType == "application/json")
        {
            appointment = JsonSerializer.Deserialize(body, SchedulerJsonContext.Default.AppointmentResponse);
        }
        else if (mediaType == "application/problem+json")
        {
            using var document = JsonDocument.Parse(body);
            problem = document.RootElement.Clone();
        }

        return new Outcome(
            contender, key, response.StatusCode, mediaType, response.Headers.Location?.OriginalString,
            response.Headers.Contains("Idempotent-Replayed"), appointment, problem, body);
    }

    /// <summary>Takes the dealership's booking lock in a transaction of the test's own; committing (or disposing) releases it.</summary>
    private async Task<LockHolder> HoldDealershipLockAsync(Guid dealershipId)
    {
        var connection = new NpgsqlConnection(pg.ConnectionString);
        await connection.OpenAsync(Ct);
        var transaction = await connection.BeginTransactionAsync(Ct);
        await using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, transaction);
        command.Parameters.AddWithValue("key", DealershipLock.KeyFor(dealershipId));
        await command.ExecuteNonQueryAsync(Ct);
        return new LockHolder(connection, transaction);
    }

    /// <summary>What one contender got back, read inside its own task.</summary>
    private sealed record Outcome(
        int Contender,
        string? IdempotencyKey,
        HttpStatusCode Status,
        string? MediaType,
        string? Location,
        bool Replayed,
        AppointmentResponse? Appointment,
        JsonElement? Problem,
        string Body);

    private sealed class LockHolder(NpgsqlConnection connection, NpgsqlTransaction transaction) : IAsyncDisposable
    {
        public Task CommitAsync(CancellationToken ct) => transaction.CommitAsync(ct);

        public async ValueTask DisposeAsync()
        {
            await transaction.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}

using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public sealed class VehicleAvailabilityOracleTests
{
    [Theory]
    [InlineData(2026, 10, 13)]
    [InlineData(2026, 3, 29)]
    [InlineData(2026, 10, 25)]
    public void Generated_availability_matches_an_independent_competence_and_overlap_oracle(int year, int month, int day)
    {
        var date = new DateOnly(year, month, day);
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
        var window = new OperatingWindow(LocalTimeConverter.ToUtc(date, new TimeOnly(0, 0), zone), LocalTimeConverter.ToUtc(date, new TimeOnly(6, 0), zone));
        var random = new Random(month * 100 + day);
        var site = Guid.NewGuid();
        for (var trial = 0; trial < 300; trial++)
        {
            var minimum = random.Next(5);
            var heavy = random.Next(2) == 0;
            var requiredBays = new HashSet<BayCapability> { BayCapability.StandardLift };
            var requiredSkills = new HashSet<Certification> { Certification.Brakes };
            if (heavy)
            {
                requiredBays.Add(BayCapability.HeavyDutyLift);
                requiredSkills.Add(Certification.HeavyVehicle);
            }
            var requirements = new JobRequirements(requiredBays, requiredSkills, minimum, 1, []);
            var bays = Enumerable.Range(0, 4).Select(i => ServiceBay.Create(Guid.NewGuid(), site, $"Bay {i}",
                random.Next(2) == 0 ? [BayCapability.StandardLift] : [BayCapability.StandardLift, BayCapability.HeavyDutyLift], isActive: random.Next(4) != 0)).ToArray();
            var technicians = Enumerable.Range(0, 6).Select(i => Technician.Create(Guid.NewGuid(), site, $"Tech {i}", $"T{i}",
                random.Next(2) == 0 ? [Certification.Brakes] : [Certification.Brakes, Certification.HeavyVehicle], isActive: random.Next(4) != 0,
                hvLevel: random.Next(5), hvLevelValidUntil: date.AddDays(random.Next(-1, 2)), hvLevelConfirmed: random.Next(2) == 0)).ToArray();
            var busy = bays.Select(b => b.Id).Concat(technicians.Select(t => t.Id)).ToDictionary(id => id, _ =>
                Enumerable.Range(0, random.Next(5)).Select(_ =>
                {
                    var start = window.StartUtc.AddMinutes(random.Next(-4, 29) * 15);
                    return TimeSlot.Create(start, start.AddMinutes(random.Next(1, 9) * 15));
                }).ToArray());
            var duration = ServiceDuration.Create(random.Next(1, 9) * 15);
            var actual = AvailabilityCalculator.Compute(window, duration, 15,
                bays.Where(b => b.Satisfies(requirements)).Select(b => new ResourceBusy(b.Id, busy[b.Id])).ToArray(),
                technicians.Where(t => t.Satisfies(requirements, date)).Select(t => new ResourceBusy(t.Id, busy[t.Id])).ToArray());
            var expected = new List<AvailabilitySlot>();
            for (var start = window.StartUtc; start.Add(duration.AsTimeSpan) <= window.EndUtc; start = start.AddMinutes(15))
            {
                var end = start.Add(duration.AsTimeSpan);
                // Independent predicate and grid enumeration: no Satisfies, Overlaps, FreeResourcesAt or interval algorithm here.
                bool Free(Guid id) => busy[id].All(a => a.StartUtc >= end || a.EndUtc <= start);
                var freeBays = bays.Count(b => b.IsActive && requiredBays.All(c => b.Capabilities.Contains(c)) && Free(b.Id));
                var freeTechnicians = technicians.Count(t => t.IsActive && requiredSkills.All(c => t.Certifications.Contains(c))
                    && (t.HvLevelValidUntil is null || t.HvLevelValidUntil >= date ? t.HvLevel : 0) >= minimum && Free(t.Id));
                if (freeBays > 0 && freeTechnicians > 0)
                {
                    expected.Add(new(start, end, freeBays, freeTechnicians));
                }
            }
            actual.ShouldBe(expected, $"date {date}, trial {trial}");
        }
    }
}

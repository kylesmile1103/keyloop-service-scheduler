using System.Globalization;
using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Builders for integration-test data. The clock starts on Monday 2026-10-12 08:00Z; the standard booking day is Tuesday 2026-10-13.</summary>
public static class TestData
{
    public static readonly DateTimeOffset DefaultNow = new(2026, 10, 12, 8, 0, 0, TimeSpan.Zero);

    public static readonly DateOnly BookingDay = new(2026, 10, 13);

    public static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    public static FakeTimeProvider Clock() => new(DefaultNow);

    public static DateTime Now => DefaultNow.UtcDateTime;

    /// <summary>The UTC instant of a wall-clock time on <see cref="BookingDay"/> in Europe/London (BST, UTC+1, on that date).</summary>
    public static DateTime LondonTime(int hour, int minute = 0) => LocalTimeConverter.ToUtc(BookingDay, new TimeOnly(hour, minute), London);

    public static Dealership NewDealership(string name = "Test Motors", string timeZoneId = "Europe/London", OperatingHours? hours = null) =>
        Dealership.Create(
            Guid.NewGuid(), name, timeZoneId, hours ?? OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0), new TimeOnly(18, 0)), Now);

    public static ServiceBay NewBay(Guid dealershipId, string name, params BayCapability[] capabilities) =>
        ServiceBay.Create(Guid.NewGuid(), dealershipId, name, capabilities);

    public static Technician NewTechnician(Guid dealershipId, string name, string employeeNumber, params Certification[] certifications) =>
        Technician.Create(Guid.NewGuid(), dealershipId, name, employeeNumber, certifications);

    public static ServiceType NewServiceType(string code, int minutes, BayCapability[] capabilities, Certification[] certifications) =>
        ServiceType.Create(Guid.NewGuid(), code, code, ServiceDuration.Create(minutes), capabilities, certifications);

    public static VehicleDetails Vehicle(string vin = "WVWZZZ1KZAW123456") => new(Vin.Create(vin), "AB12 CDE", "Volkswagen", "Golf");

    /// <summary>
    /// A customer whose email is on a reserved domain (<c>example.com</c>), which the notification dispatcher never sends to; pass
    /// <paramref name="email"/> (e.g. <see cref="DeliverableEmail"/>) when a test needs the email to be sent.
    /// </summary>
    public static CustomerDetails Customer(int n = 1, string? email = null) =>
        new(
            string.Create(CultureInfo.InvariantCulture, $"Customer {n}"),
            email ?? string.Create(CultureInfo.InvariantCulture, $"customer{n}@example.com"),
            string.Create(CultureInfo.InvariantCulture, $"+44 7700 9{n % 100000:D5}"));

    /// <summary>
    /// An address the notification dispatcher does send to (not a reserved domain). Tests deliver only to a capturing sender or a
    /// Mailpit container; <c>.local</c> is the multicast-DNS special-use name (RFC 6762), never resolved on the public internet.
    /// </summary>
    public static string DeliverableEmail(int n = 1) => string.Create(CultureInfo.InvariantCulture, $"customer{n}@inbox.keyloop.local");

    /// <summary>A valid VIN that differs per <paramref name="n"/> (its last six characters are <paramref name="n"/> modulo 10⁶).</summary>
    public static string VinFor(int n) => string.Create(CultureInfo.InvariantCulture, $"WVWZZZ1KZAW{n % 1_000_000:D6}");

    /// <summary>
    /// A valid <c>POST …/appointments</c> body for <paramref name="customerIndex"/>: distinct customer details and VIN per index, so
    /// concurrent requests are distinct requests (and distinct idempotency fingerprints).
    /// </summary>
    public static BookAppointmentRequest BookingRequest(
        Guid serviceTypeId, DateTime startUtc, int customerIndex = 1, Guid? preferredBayId = null, Guid? preferredTechnicianId = null, string? notes = null,
        string? email = null)
    {
        var customer = Customer(customerIndex, email);
        return new BookAppointmentRequest(
            serviceTypeId,
            startUtc,
            new CustomerRequest(customer.Name, customer.Email, customer.Phone),
            new VehicleRequest(VinFor(customerIndex), "AB12 CDE", "Volkswagen", "Golf"),
            preferredBayId,
            preferredTechnicianId,
            notes);
    }

    /// <summary>
    /// A confirmed appointment on <see cref="BookingDay"/> (or the date of <paramref name="startUtc"/>) built through the aggregate, so it raises
    /// <c>AppointmentBooked</c>, booked at <paramref name="bookedAtUtc"/> (default <see cref="Now"/>), which also dates its outbox row.
    /// </summary>
    public static Appointment NewAppointment(
        Dealership dealership, ServiceType serviceType, ServiceBay bay, Technician technician, DateTime startUtc, int customer = 1, string vin = "WVWZZZ1KZAW123456",
        string? email = null, DateTime? bookedAtUtc = null)
    {
        ArgumentNullException.ThrowIfNull(dealership);
        var window = dealership.ResolveOperatingWindow(LocalTimeConverter.ToLocalDate(startUtc, dealership.TimeZone))
            ?? throw new InvalidOperationException("The dealership is closed on that date.");
        return Appointment.Book(
            Guid.CreateVersion7(), dealership, serviceType, bay, technician, TimeSlot.FromStart(startUtc, serviceType.Duration), window,
            Customer(customer, email), Vehicle(vin), notes: null, bookedAtUtc ?? Now);
    }

    /// <summary>
    /// The contention fixture (SYSTEM_DESIGN §14.4): one bay {EvHighVoltage}, one technician {HighVoltageElectrical} and
    /// <c>EV-BATTERY-CHECK</c> (60 min), open Monday–Saturday 08:00–18:00 Europe/London.
    /// </summary>
    public static async Task<(Guid DealershipId, Guid ServiceTypeId, Guid BayId, Guid TechnicianId)> ContentionDealershipAsync(SchedulerDbContext db)
    {
        ArgumentNullException.ThrowIfNull(db);
        var dealership = NewDealership("Contention Motors", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0), new TimeOnly(18, 0)));
        var bay = NewBay(dealership.Id, "EV Bay", BayCapability.EvHighVoltage);
        var technician = NewTechnician(dealership.Id, "Ben Okafor", "C-0001", Certification.HighVoltageElectrical);
        var serviceType = NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]);
        db.AddRange(dealership, bay, technician, serviceType);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return (dealership.Id, serviceType.Id, bay.Id, technician.Id);
    }

    /// <summary>A dealership with two standard bays, two general technicians and a 60-minute interim service, saved; the shape most persistence tests need.</summary>
    public static async Task<Workshop> WorkshopAsync(SchedulerDbContext db)
    {
        ArgumentNullException.ThrowIfNull(db);
        var dealership = NewDealership();
        var bay1 = NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift);
        var bay2 = NewBay(dealership.Id, "Bay 2", BayCapability.StandardLift);
        var technician1 = NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService);
        var technician2 = NewTechnician(dealership.Id, "Ben Okafor", "T-1002", Certification.GeneralService);
        var interim = NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]);
        db.AddRange(dealership, bay1, bay2, technician1, technician2, interim);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return new Workshop(dealership, interim, bay1, bay2, technician1, technician2);
    }

    public sealed record Workshop(
        Dealership Dealership, ServiceType Interim, ServiceBay Bay1, ServiceBay Bay2, Technician Technician1, Technician Technician2)
    {
        public Appointment Book(
            DateTime startUtc, ServiceBay? bay = null, Technician? technician = null, int customer = 1, string? email = null, DateTime? bookedAtUtc = null) =>
            NewAppointment(Dealership, Interim, bay ?? Bay1, technician ?? Technician1, startUtc, customer, email: email, bookedAtUtc: bookedAtUtc);
    }
}

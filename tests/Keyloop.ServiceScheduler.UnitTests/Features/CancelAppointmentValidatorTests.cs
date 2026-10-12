using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The cancellation request's shape rule (400 <c>validation-error</c> keyed <c>reason</c>). It measures the reason after trimming, as
/// <see cref="Appointment.Cancel"/> does, so a reason the validator accepts never makes the aggregate throw (which would be a 500).
/// </summary>
public class CancelAppointmentValidatorTests
{
    private const string Message = "reason is required, 1 to 500 characters after trimming.";

    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);

    private readonly CancelAppointmentValidator _validator = new();

    [Theory]
    [InlineData("Customer called to reschedule.")]
    [InlineData("x")]
    public void Accepts_a_reason(string reason)
    {
        var result = _validator.Validate(new CancelAppointmentRequest(reason));

        result.IsValid.ShouldBeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public void Accepts_500_characters_measured_after_trimming()
    {
        _validator.Validate(new CancelAppointmentRequest(new string('a', Appointment.MaxCancellationReasonLength))).IsValid.ShouldBeTrue();
        _validator.Validate(new CancelAppointmentRequest($"  {new string('a', Appointment.MaxCancellationReasonLength)}  ")).IsValid.ShouldBeTrue();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")] // blank after trimming, as Appointment.Cancel measures it
    [InlineData(null)] // "reason" missing from the JSON body, or null
    public void Rejects_a_blank_reason(string? reason) => ShouldFailOnReason(reason);

    [Fact]
    public void Rejects_a_reason_longer_than_500_characters() => ShouldFailOnReason(new string('a', Appointment.MaxCancellationReasonLength + 1));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Whatever_it_accepts_the_aggregate_accepts(string padding)
    {
        // The validator and the domain agree at the boundary: a reason passes validation exactly when Cancel accepts it.
        foreach (var length in new[] { 0, 1, Appointment.MaxCancellationReasonLength, Appointment.MaxCancellationReasonLength + 1 })
        {
            var reason = $"{padding}{new string('r', length)}{padding}";
            var domainAccepts = Record.Exception(() => NewConfirmedAppointment().Cancel(reason, Now)) is null;

            _validator.Validate(new CancelAppointmentRequest(reason)).IsValid.ShouldBe(domainAccepts, $"length {length}, padding '{padding}'");
        }
    }

    private static Appointment NewConfirmedAppointment()
    {
        var dealership = Dealership.Create(
            Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), Now);
        var interim = ServiceType.Create(
            Guid.NewGuid(), "INTERIM-SERVICE", "Interim Service", ServiceDuration.Create(60), [BayCapability.StandardLift], [Certification.GeneralService]);
        var bay = ServiceBay.Create(Guid.NewGuid(), dealership.Id, "Bay 1", [BayCapability.StandardLift]);
        var technician = Technician.Create(Guid.NewGuid(), dealership.Id, "Amelia Clarke", "T-1001", [Certification.GeneralService]);
        var window = dealership.ResolveOperatingWindow(new DateOnly(2026, 10, 13)).ShouldNotBeNull();
        return Appointment.Book(
            Guid.NewGuid(), dealership, interim, bay, technician, TimeSlot.FromStart(new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), interim.Duration),
            window, new CustomerDetails("Jane Doe", "jane.doe@example.com", "+44 7700 900123"),
            new VehicleDetails(Vin.Create("WVWZZZ1KZAW123456"), "AB12 CDE", "Volkswagen", "Golf"), notes: null, Now);
    }

    private void ShouldFailOnReason(string? reason)
    {
        var failure = _validator.Validate(new CancelAppointmentRequest(reason!)).Errors.ShouldHaveSingleItem();
        failure.PropertyName.ShouldBe("Reason");
        failure.ErrorMessage.ShouldBe(Message);
    }
}

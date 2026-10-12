using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The booking request's shape rules (400 <c>validation-error</c>). They are at least as strict as the domain constructors the handler
/// calls (<c>CustomerDetails</c>, <c>VehicleDetails</c>, <c>Vin</c>, notes in <c>Appointment.Book</c>), which trim before measuring:
/// anything the validator lets through must construct, or a malformed request would surface as a 500. Business rules (opening hours,
/// lead time, grid) are the handler's 422s, not shape.
/// </summary>
public class BookAppointmentValidatorTests
{
    private static readonly BookAppointmentRequest Valid = new(
        Guid.Parse("3153f30d-5700-8f07-a25d-4a4ea44dfeef"),
        new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc),
        new CustomerRequest("Alex Morgan", "alex.morgan@example.com", "+44 7700 900123"),
        new VehicleRequest("WVWZZZ1KZAW123456", "AB12 CDE", "Volkswagen", "Golf"),
        PreferredBayId: null,
        PreferredTechnicianId: null,
        Notes: "Rattle from the front left wheel.");

    private readonly BookAppointmentValidator _validator = new();

    [Fact]
    public void Accepts_a_well_formed_request()
    {
        var result = _validator.Validate(Valid);

        result.IsValid.ShouldBeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public void Accepts_optional_fields_left_out_and_lower_case_vins()
    {
        var request = Valid with
        {
            Notes = null,
            PreferredBayId = Guid.NewGuid(),
            PreferredTechnicianId = Guid.Empty, // a hint, never validated: an unusable hint is ignored by allocation
            Vehicle = Valid.Vehicle with { Vin = "wvwzzz1kzaw123456" },
        };

        _validator.Validate(request).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Rejects_the_empty_service_type_id() =>
        ShouldFailOnly(Valid with { ServiceTypeId = Guid.Empty }, "ServiceTypeId", "serviceTypeId is required and must not be the empty id.");

    [Theory]
    [InlineData(DateTimeKind.Unspecified)] // "2026-10-13T09:00:00": no zone at all
    [InlineData(DateTimeKind.Local)] // "2026-10-13T10:00:00+01:00": System.Text.Json converts an offset to machine-local time
    public void Rejects_a_start_that_is_not_utc(DateTimeKind kind) =>
        ShouldFailOnly(
            Valid with { StartUtc = DateTime.SpecifyKind(Valid.StartUtc, kind) },
            "StartUtc",
            "startUtc must be a UTC instant ending in Z, for example 2026-10-13T09:00:00Z.");

    [Theory]
    [InlineData(30, 0, 0)] // seconds
    [InlineData(0, 500, 0)] // milliseconds
    [InlineData(0, 0, 1)] // a single tick
    public void Rejects_a_start_that_is_not_a_whole_minute(int seconds, int milliseconds, int ticks) =>
        ShouldFailOnly(
            Valid with { StartUtc = Valid.StartUtc.AddSeconds(seconds).AddMilliseconds(milliseconds).AddTicks(ticks) },
            "StartUtc",
            "startUtc must be a whole minute, without seconds or fractions.");

    [Fact]
    public void Rejects_a_missing_customer() =>
        ShouldFailOnly(Valid with { Customer = null! }, "Customer", "customer is required.");

    [Theory]
    [InlineData("")]
    [InlineData("   ")] // blank after trimming, as CustomerDetails measures it
    [InlineData(null)]
    public void Rejects_a_blank_customer_name(string? name) =>
        ShouldFailOnly(Valid with { Customer = Valid.Customer with { Name = name! } }, "Customer.Name", "customer.name is required, at most 120 characters.");

    [Fact]
    public void Rejects_a_customer_name_longer_than_120_characters()
    {
        ShouldFailOnly(Valid with { Customer = Valid.Customer with { Name = new string('a', 121) } }, "Customer.Name", "customer.name is required, at most 120 characters.");
        _validator.Validate(Valid with { Customer = Valid.Customer with { Name = $"  {new string('a', 120)}  " } }).IsValid.ShouldBeTrue("measured after trimming");
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("@example.com")]
    public void Rejects_a_malformed_email(string? email) =>
        ShouldFailOnly(
            Valid with { Customer = Valid.Customer with { Email = email! } },
            "Customer.Email",
            "customer.email must be an email address of at most 254 characters.");

    [Fact]
    public void Rejects_an_email_longer_than_254_characters() =>
        ShouldFailOnly(
            Valid with { Customer = Valid.Customer with { Email = $"{new string('a', 243)}@example.com" } }, // 255 characters
            "Customer.Email",
            "customer.email must be an email address of at most 254 characters.");

    [Theory]
    [InlineData("12")] // too short
    [InlineData("+44 7700 900123 ext. 4")] // letters and dots
    [InlineData("0118 496 0000 0118 496 0000 0118 496 000000")] // more than 40 characters
    [InlineData("   ")]
    [InlineData(null)]
    public void Rejects_a_malformed_phone(string? phone) =>
        ShouldFailOnly(
            Valid with { Customer = Valid.Customer with { Phone = phone! } },
            "Customer.Phone",
            "customer.phone must be 3 to 40 characters of digits, spaces and + ( ) -.");

    [Fact]
    public void Accepts_a_phone_with_brackets_and_dashes() =>
        _validator.Validate(Valid with { Customer = Valid.Customer with { Phone = "+44 (0)118-496-0000" } }).IsValid.ShouldBeTrue();

    [Fact]
    public void Rejects_a_missing_vehicle() =>
        ShouldFailOnly(Valid with { Vehicle = null! }, "Vehicle", "vehicle is required.");

    [Theory]
    [InlineData("WVWZZZ1KZAW12345")] // 16 characters
    [InlineData("WVWZZZ1KZAW1234567")] // 18 characters
    [InlineData("WVWZZZ1KZAI123456")] // I is never used in a VIN
    [InlineData("WVWZZZ1KZAW12345-")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_a_malformed_vin(string? vin) =>
        ShouldFailOnly(
            Valid with { Vehicle = Valid.Vehicle with { Vin = vin! } },
            "Vehicle.Vin",
            "vehicle.vin must be a 17-character VIN of digits and letters other than I, O and Q.");

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("AB12 CDE AB12 CDE")] // 17 characters
    [InlineData(null)]
    public void Rejects_a_blank_or_long_registration(string? registration) =>
        ShouldFailOnly(
            Valid with { Vehicle = Valid.Vehicle with { Registration = registration! } },
            "Vehicle.Registration",
            "vehicle.registration is required, at most 16 characters.");

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("61")] // replaced by 61 characters below
    public void Rejects_a_blank_or_long_make_or_model(string? value)
    {
        value = value == "61" ? new string('m', 61) : value;
        ShouldFailOnly(Valid with { Vehicle = Valid.Vehicle with { Make = value! } }, "Vehicle.Make", "vehicle.make is required, at most 60 characters.");
        ShouldFailOnly(Valid with { Vehicle = Valid.Vehicle with { Model = value! } }, "Vehicle.Model", "vehicle.model is required, at most 60 characters.");
    }

    [Fact]
    public void Rejects_notes_longer_than_1000_characters_after_trimming()
    {
        ShouldFailOnly(Valid with { Notes = new string('n', 1001) }, "Notes", "notes must be at most 1000 characters.");
        _validator.Validate(Valid with { Notes = $"  {new string('n', 1000)}  " }).IsValid.ShouldBeTrue("Appointment.Book trims notes before measuring");
    }

    [Fact]
    public void Reports_every_invalid_field_once()
    {
        var request = Valid with
        {
            ServiceTypeId = Guid.Empty,
            StartUtc = DateTime.SpecifyKind(Valid.StartUtc.AddSeconds(30), DateTimeKind.Unspecified),
            Customer = new CustomerRequest("", "nope", "x"),
            Vehicle = new VehicleRequest("short", "", "", ""),
        };

        var failures = _validator.Validate(request).Errors;

        failures.Select(f => f.PropertyName).ShouldBe(
            ["ServiceTypeId", "StartUtc", "Customer.Name", "Customer.Email", "Customer.Phone", "Vehicle.Vin", "Vehicle.Registration", "Vehicle.Make", "Vehicle.Model"],
            ignoreOrder: true);
    }

    private void ShouldFailOnly(BookAppointmentRequest request, string propertyName, string message)
    {
        var failure = _validator.Validate(request).Errors.ShouldHaveSingleItem();
        failure.PropertyName.ShouldBe(propertyName);
        failure.ErrorMessage.ShouldBe(message);
    }
}

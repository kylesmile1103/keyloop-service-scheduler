using FluentValidation;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Shape rules for <see cref="BookAppointmentRequest"/>, applied by <c>ValidationFilter</c> (400 <c>validation-error</c>, keys such as
/// <c>startUtc</c> and <c>customer.email</c>). Lengths are measured after trimming, as the domain constructors measure them, so a
/// request that passes always constructs <see cref="CustomerDetails"/>, <see cref="VehicleDetails"/> and the appointment's notes.
/// Business rules (opening hours, lead time, horizon, slot grid, resources) are the handler's 422s.
/// </summary>
public sealed class BookAppointmentValidator : AbstractValidator<BookAppointmentRequest>
{
    public BookAppointmentValidator()
    {
        RuleFor(r => r.ServiceTypeId).NotEqual(Guid.Empty).WithMessage("serviceTypeId is required and must not be the empty id.");

        // System.Text.Json reads "…Z" as Kind=Utc, an offset as machine-local time (Kind=Local) and no zone as Unspecified.
        RuleFor(r => r.StartUtc)
            .Cascade(CascadeMode.Stop)
            .Must(start => start.Kind == DateTimeKind.Utc).WithMessage("startUtc must be a UTC instant ending in Z, for example 2026-10-13T09:00:00Z.")
            .Must(start => start.Ticks % TimeSpan.TicksPerMinute == 0).WithMessage("startUtc must be a whole minute, without seconds or fractions.");

        RuleFor(r => r.Customer).Cascade(CascadeMode.Stop).NotNull().WithMessage("customer is required.").SetValidator(new CustomerRequestValidator());
        RuleFor(r => r.Vehicle).Cascade(CascadeMode.Stop).NotNull().WithMessage("vehicle is required.").SetValidator(new VehicleRequestValidator());

        RuleFor(r => r.Notes)
            .Must(notes => notes is null || notes.Trim().Length <= Appointment.MaxNotesLength)
            .WithMessage($"notes must be at most {Appointment.MaxNotesLength} characters.");
    }

    /// <summary>Trimmed length within [<paramref name="min"/>, <paramref name="max"/>], as <c>Guard.Required</c> measures it.</summary>
    internal static bool TrimmedLength(string? value, int min, int max) => value?.Trim().Length is { } length && length >= min && length <= max;

    private sealed class CustomerRequestValidator : AbstractValidator<CustomerRequest>
    {
        public CustomerRequestValidator()
        {
            RuleFor(c => c.Name).Must(name => TrimmedLength(name, 1, 120)).WithMessage("customer.name is required, at most 120 characters.");

            RuleFor(c => c.Email)
                .Cascade(CascadeMode.Stop)
                .Must(email => TrimmedLength(email, 3, 254)).WithMessage(EmailMessage)
                .EmailAddress().WithMessage(EmailMessage);

            RuleFor(c => c.Phone)
                .Must(phone => TrimmedLength(phone, 3, 40) && phone.All(c => char.IsAsciiDigit(c) || c is ' ' or '+' or '(' or ')' or '-'))
                .WithMessage("customer.phone must be 3 to 40 characters of digits, spaces and + ( ) -.");
        }

        private const string EmailMessage = "customer.email must be an email address of at most 254 characters.";
    }

    private sealed class VehicleRequestValidator : AbstractValidator<VehicleRequest>
    {
        public VehicleRequestValidator()
        {
            RuleFor(v => v.Vin)
                .Must(vin => Vin.TryCreate(vin, out _))
                .WithMessage("vehicle.vin must be a 17-character VIN of digits and letters other than I, O and Q.");
            RuleFor(v => v.Registration).Must(registration => TrimmedLength(registration, 1, 16)).WithMessage("vehicle.registration is required, at most 16 characters.");
            RuleFor(v => v.Make).Must(make => TrimmedLength(make, 1, 60)).WithMessage("vehicle.make is required, at most 60 characters.");
            RuleFor(v => v.Model).Must(model => TrimmedLength(model, 1, 60)).WithMessage("vehicle.model is required, at most 60 characters.");
        }
    }
}

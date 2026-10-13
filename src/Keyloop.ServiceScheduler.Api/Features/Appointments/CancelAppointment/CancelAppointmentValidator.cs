using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary>Validates request shape for <see cref="CancelAppointmentRequest"/>.</summary>
public sealed class CancelAppointmentValidator : AbstractValidator<CancelAppointmentRequest>
{
    public CancelAppointmentValidator() =>
        RuleFor(r => r.Reason)
            .Must(reason => TrimmedText.HasLength(reason, 1, Appointment.MaxCancellationReasonLength))
            .WithMessage($"reason is required, 1 to {Appointment.MaxCancellationReasonLength} characters after trimming.");
}

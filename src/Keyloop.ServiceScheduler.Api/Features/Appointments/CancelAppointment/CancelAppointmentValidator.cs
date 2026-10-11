using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary>
/// The shape rule for <see cref="CancelAppointmentRequest"/>, applied by <c>ValidationFilter</c> (400 <c>validation-error</c> keyed
/// <c>reason</c>). The reason is measured after trimming, as <see cref="Appointment.Cancel"/> measures it, so a request that passes never
/// makes the aggregate throw. Whether the appointment can be cancelled at all is state, not shape: the handler's 404 and 409s.
/// </summary>
public sealed class CancelAppointmentValidator : AbstractValidator<CancelAppointmentRequest>
{
    public CancelAppointmentValidator() =>
        RuleFor(r => r.Reason)
            .Must(reason => TrimmedText.HasLength(reason, 1, Appointment.MaxCancellationReasonLength))
            .WithMessage($"reason is required, 1 to {Appointment.MaxCancellationReasonLength} characters after trimming.");
}

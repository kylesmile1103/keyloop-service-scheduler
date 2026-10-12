using FluentValidation;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

public sealed class ListAppointmentsValidator : AbstractValidator<ListAppointmentsQuery>
{
    public ListAppointmentsValidator()
    {
        RuleFor(q => q.From)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("from is required, as yyyy-MM-dd.")
            .Must((query, _) => query.LocalFrom is not null)
            .WithMessage("from must be a calendar date in the form yyyy-MM-dd, for example 2026-10-12.");
        RuleFor(q => q.To)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("to is required, as yyyy-MM-dd.")
            .Must((query, _) => query.LocalTo is not null)
            .WithMessage("to must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.");

        When(q => q.LocalFrom is not null && q.LocalTo is not null, () =>
            RuleFor(q => q.To)
                .Cascade(CascadeMode.Stop)
                .Must((q, _) => q.LocalFrom <= q.LocalTo).WithMessage("to must be on or after from.")
                .Must((q, _) => q.LocalTo!.Value.DayNumber - q.LocalFrom!.Value.DayNumber < ListAppointmentsQuery.MaxDays)
                .WithMessage("The inclusive date range must span at most 62 calendar days."));

        RuleFor(q => q.Status)
            .Must(statuses => statuses.All(status => Enum.GetNames<AppointmentStatus>().Contains(status, StringComparer.Ordinal)))
            .WithMessage("status must be a declared appointment status name: Confirmed, CheckedIn, InProgress, Completed, Cancelled or NoShow. Repeat status to select more than one.");
    }
}

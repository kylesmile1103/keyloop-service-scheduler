using FluentValidation;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary>Validates query parameters for <see cref="GetWorkshopScheduleQuery"/>.</summary>
public sealed class GetWorkshopScheduleValidator : AbstractValidator<GetWorkshopScheduleQuery>
{
    public GetWorkshopScheduleValidator() =>
        RuleFor(q => q.Date)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("date is required, as yyyy-MM-dd.")
            .Must((query, _) => query.LocalDate is not null)
            .WithMessage("date must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.");
}

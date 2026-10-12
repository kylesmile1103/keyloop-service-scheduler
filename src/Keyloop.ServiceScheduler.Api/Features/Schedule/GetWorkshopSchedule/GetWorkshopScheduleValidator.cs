using FluentValidation;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary>
/// Shape rule for <see cref="GetWorkshopScheduleQuery"/>, applied by <c>ValidationFilter</c> (400 <c>validation-error</c>, key
/// <c>date</c>): the date is required and strictly <c>yyyy-MM-dd</c>, with availability's messages. Unlike availability there is no
/// range. A past day is the board's history, a later one is simply empty, and every well-formed date resolves without error, even at
/// the ends of the calendar, where <see cref="TimeZoneInfo"/> clamps an opening or closing it cannot represent.
/// </summary>
public sealed class GetWorkshopScheduleValidator : AbstractValidator<GetWorkshopScheduleQuery>
{
    public GetWorkshopScheduleValidator() =>
        RuleFor(q => q.Date)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("date is required, as yyyy-MM-dd.")
            .Must((query, _) => query.LocalDate is not null)
            .WithMessage("date must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.");
}

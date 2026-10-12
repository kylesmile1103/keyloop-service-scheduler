using System.Globalization;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>
/// Shape rules for <see cref="GetAvailabilityQuery"/>, applied by <c>ValidationFilter</c> (400 <c>validation-error</c>, keys
/// <c>serviceTypeId</c>, <c>date</c>, <c>powertrain</c>, <c>manufacturer</c>, <c>vehicleClass</c> and <c>needsLiveDiagnosis</c>). The date range is deliberately loose, from yesterday to the booking horizon plus a day
/// in UTC terms, because the date is local to the dealership; <c>BookingWindowPolicy</c> applies the exact rule when booking.
/// </summary>
public sealed class GetAvailabilityValidator : AbstractValidator<GetAvailabilityQuery>
{
    public GetAvailabilityValidator(TimeProvider timeProvider, IOptions<SchedulingOptions> options)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        // Exactly one member name: Enum.TryParse would OR a comma list (also what a repeated parameter binds as) into another member.
        RuleFor(q => q.Powertrain).Must((query, p) => p is null || query.PowertrainValue is not null)
            .WithMessage($"powertrain must be exactly one of {ExactEnumName.Describe<Domain.Scheduling.Powertrain>()}.");
        RuleFor(q => q.VehicleClass).Must((query, c) => c is null || query.VehicleClassValue is not null)
            .WithMessage($"vehicleClass must be exactly one of {ExactEnumName.Describe<Domain.Scheduling.VehicleClass>()}.");
        RuleFor(q => q.NeedsLiveDiagnosis).Must((query, flag) => flag is null || query.LiveDiagnosis is not null)
            .WithMessage("needsLiveDiagnosis must be true or false.");
        RuleFor(q => q.Manufacturer).Must(m => m is null || (m.Trim().Length is >= 1 and <= 32
            && m.Trim().All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))).WithMessage("manufacturer must be an OEM code of at most 32 characters.");
        var horizonDays = options.Value.BookingHorizonDays;

        // Read per validation, not per construction: the clock moves.
        DateOnly Today() => DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        DateOnly Earliest() => Today().AddDays(-1);
        DateOnly Latest() => Today().AddDays(horizonDays + 1);

        // Null also when the value was not a GUID: the generated binder leaves a nullable parameter null on a parse failure and,
        // because the endpoint has a filter, still runs it (the 400 is then this validation problem, keyed serviceTypeId).
        RuleFor(q => q.ServiceTypeId)
            .Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("serviceTypeId is required and must be a GUID.")
            .NotEqual(Guid.Empty).WithMessage("serviceTypeId must not be the empty id.");

        RuleFor(q => q.Date)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("date is required, as yyyy-MM-dd.")
            .Must((query, _) => query.LocalDate is not null)
            .WithMessage("date must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.")
            .Must((query, _) => query.LocalDate >= Earliest() && query.LocalDate <= Latest())
            .WithMessage(_ => string.Create(
                CultureInfo.InvariantCulture, $"date must be between {Earliest():yyyy-MM-dd} and {Latest():yyyy-MM-dd}."));
    }
}

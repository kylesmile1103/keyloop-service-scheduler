using FluentValidation;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

public sealed class TriageBookingValidator : AbstractValidator<TriageBookingRequest>
{
    public TriageBookingValidator(IOptions<TriageOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        RuleFor(r => r.Description).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("description is required.")
            .Must(value => value.Trim().Length > 0 && value.Trim().Length <= options.Value.MaxDescriptionLength)
            .WithMessage($"description must contain 1 to {options.Value.MaxDescriptionLength} characters after trimming.");
    }
}

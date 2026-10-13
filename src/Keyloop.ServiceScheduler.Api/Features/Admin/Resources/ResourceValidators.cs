using FluentValidation;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

public sealed class TechnicianWriteValidator : AbstractValidator<TechnicianWriteRequest>
{
    public TechnicianWriteValidator()
    {
        RuleFor(r => r.Name).NotEmpty().Must(s => s is not null && s.Trim().Length is >= 1 and <= 120 && !s.Any(char.IsControl));
        RuleFor(r => r.EmployeeNumber).NotEmpty().Must(s => s is not null && s.Trim().Length is >= 1 and <= 32 && !s.Any(char.IsControl));
        RuleFor(r => r.HvLevel).InclusiveBetween(0, 4);
        RuleFor(r => r.Certifications).NotNull().Must(v => v is not null && v.Length <= 32 && v.Distinct().Count() == v.Length);
        RuleForEach(r => r.Certifications).IsInEnum();
        RuleFor(r => r.BrandSpecialisms).NotNull().Must(v => v is not null && v.Length <= 16);
        RuleForEach(r => r.BrandSpecialisms).NotEmpty().Matches("^[A-Za-z0-9][A-Za-z0-9-]{0,31}$");
    }
}

public sealed class BayWriteValidator : AbstractValidator<BayWriteRequest>
{
    public BayWriteValidator()
    {
        RuleFor(r => r.Name).NotEmpty().Must(s => s is not null && s.Trim().Length is >= 1 and <= 100 && !s.Any(char.IsControl));
        RuleFor(r => r.Capabilities).NotNull().Must(v => v is not null && v.Length <= 32 && v.Distinct().Count() == v.Length);
        RuleForEach(r => r.Capabilities).IsInEnum();
    }
}

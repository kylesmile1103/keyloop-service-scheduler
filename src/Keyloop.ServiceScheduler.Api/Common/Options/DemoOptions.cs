using System.ComponentModel.DataAnnotations;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>Demo tooling configuration for local and demo environments.</summary>
public sealed class DemoOptions : IValidatableObject
{
    public const string SectionName = "Demo";

    /// <summary>Minimum length required for <see cref="ReseedKey"/> when set.</summary>
    public const int MinimumReseedKeyLength = 16;

    /// <summary>Shared secret required in the <c>X-Reseed-Key</c> header for <c>POST /api/v1/admin/demo/reseed</c>.</summary>
    public string? ReseedKey { get; set; }

    /// <summary>Returns true when demo seeding is enabled and a reseed key is configured.</summary>
    public bool ReseedEnabled(DatabaseOptions database)
    {
        ArgumentNullException.ThrowIfNull(database);
        return database.SeedDemoData && !string.IsNullOrEmpty(ReseedKey);
    }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!string.IsNullOrEmpty(ReseedKey) && ReseedKey.Length < MinimumReseedKeyLength)
        {
            yield return new ValidationResult(
                $"{nameof(ReseedKey)} must be at least {MinimumReseedKeyLength} characters when set.", [nameof(ReseedKey)]);
        }
    }
}

[OptionsValidator]
public sealed partial class DemoOptionsValidator : IValidateOptions<DemoOptions>;

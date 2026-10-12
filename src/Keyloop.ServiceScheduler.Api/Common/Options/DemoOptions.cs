using System.ComponentModel.DataAnnotations;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>
/// Demo tooling for the local Aspire run (Addendum C §C3, ADR-019). Validated at startup by <see cref="DemoOptionsValidator"/>.
/// </summary>
public sealed class DemoOptions : IValidatableObject
{
    public const string SectionName = "Demo";

    /// <summary>The shortest <see cref="ReseedKey"/> accepted: Admin authorization and this key guard the reseed route.</summary>
    public const int MinimumReseedKeyLength = 16;

    /// <summary>
    /// The shared secret of <c>POST /api/v1/admin/demo/reseed</c> (header <c>X-Reseed-Key</c>). The route exists only when this is set
    /// and <c>Database:SeedDemoData</c> is true. The Aspire AppHost generates a key for every run and passes it as
    /// <c>Demo__ReseedKey</c>; it never belongs in an <c>appsettings</c> file. Unset (or empty) means no reseed route.
    /// </summary>
    public string? ReseedKey { get; set; }

    /// <summary>Whether the reseed route is mapped: demo data is seeded here and a key is configured.</summary>
    public bool ReseedEnabled(DatabaseOptions database)
    {
        ArgumentNullException.ThrowIfNull(database);
        return database.SeedDemoData && !string.IsNullOrEmpty(ReseedKey);
    }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // The message names the rule, never the value: it is logged at startup (event 1103).
        if (!string.IsNullOrEmpty(ReseedKey) && ReseedKey.Length < MinimumReseedKeyLength)
        {
            yield return new ValidationResult(
                $"{nameof(ReseedKey)} must be at least {MinimumReseedKeyLength} characters when set.", [nameof(ReseedKey)]);
        }
    }
}

/// <summary>Generated from the <see cref="DemoOptions"/> <see cref="IValidatableObject"/> rule (Addendum A §A4).</summary>
[OptionsValidator]
public sealed partial class DemoOptionsValidator : IValidateOptions<DemoOptions>;

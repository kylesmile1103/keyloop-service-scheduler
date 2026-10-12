using System.ComponentModel.DataAnnotations;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

public enum AuthMode { CloudflareAccess, Development, None }

/// <summary>Access identity and local API role membership. Role lists contain exact emails or @domain entries, supplied outside source control.</summary>
public sealed class AuthOptions : IValidatableObject
{
    public const string SectionName = "Auth";
    public AuthMode Mode { get; set; } = AuthMode.CloudflareAccess;
    public string TeamDomain { get; set; } = "";
    public string[] Audience { get; set; } = [];
    public RoleOptions Roles { get; set; } = new();
    public DevelopmentOptions Development { get; set; } = new();
    public TimeSpan ClockSkew { get; set; } = TimeSpan.FromSeconds(30);

    public sealed class RoleOptions
    {
        public string[] Admin { get; set; } = [];
        public string[] ServiceAdvisor { get; set; } = [];
        public string[] Viewer { get; set; } = [];
    }

    public sealed class DevelopmentOptions
    {
        public string Email { get; set; } = "admin@keyloop.test";
        // Bind into an empty array: generated binding appends to constructor defaults. The Development file supplies Admin.
        public string[] Roles { get; set; } = [];
    }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!Enum.IsDefined(Mode))
        {
            yield return new("Mode is invalid.", [nameof(Mode)]);
        }

        if (ClockSkew < TimeSpan.Zero || ClockSkew > TimeSpan.FromMinutes(1))
        {
            yield return new("ClockSkew must be between zero and one minute.", [nameof(ClockSkew)]);
        }

        if (Mode == AuthMode.CloudflareAccess)
        {
            if (!ValidTeamDomain(TeamDomain))
            {
                yield return new("TeamDomain must be https://<team>.cloudflareaccess.com without a trailing slash, port or path.", [nameof(TeamDomain)]);
            }

            if (Audience.Length == 0 || Audience.Any(string.IsNullOrWhiteSpace))
            {
                yield return new("Audience requires at least one non-empty application AUD tag.", [nameof(Audience)]);
            }
        }
        foreach (var (role, members) in Memberships())
        {
            for (var i = 0; i < members.Length; i++)
            {
                if (!ValidMember(members[i]))
                {
                    yield return new($"Roles.{role}[{i}] must be a bare email or @domain.", [nameof(Roles)]);
                }
            }
        }
        if (Mode == AuthMode.Development)
        {
            if (!ValidEmail(Development.Email))
            {
                yield return new("Development.Email must be a bare email.", [nameof(Development)]);
            }

            if (Development.Roles.Any(role => !string.IsNullOrEmpty(role) && !SchedulerRoles.All.Contains(role, StringComparer.Ordinal)))
            {
                yield return new("Development.Roles must contain only Admin, ServiceAdvisor or Viewer.", [nameof(Development)]);
            }
        }
    }

    internal IEnumerable<(string Role, string[] Members)> Memberships() =>
        [(SchedulerRoles.Admin, Roles.Admin), (SchedulerRoles.ServiceAdvisor, Roles.ServiceAdvisor), (SchedulerRoles.Viewer, Roles.Viewer)];

    internal static bool ValidTeamDomain(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.UserInfo.Length == 0 && uri.IsDefaultPort
        && uri.Host.EndsWith(".cloudflareaccess.com", StringComparison.Ordinal)
        && uri.Host[..^".cloudflareaccess.com".Length] is { Length: > 0 } team
        && team.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')
        && value == $"https://{uri.Host}";

    /// <summary>The longest address SMTP can carry (RFC 5321 path limit). The audit actor column holds <c>user:</c> plus this.</summary>
    internal const int MaxEmailLength = 254;

    internal static bool ValidEmail(string value) => value.Length <= MaxEmailLength && MailAddress.TryCreate(value, out var address)
        && address.Address == value && value.Count(c => c == '@') == 1 && !value.Any(char.IsWhiteSpace);

    private static bool ValidMember(string value) => value.StartsWith('@')
        ? value.Length > 1 && Uri.CheckHostName(value[1..]) == UriHostNameType.Dns && !value.Contains('*')
        : ValidEmail(value);
}

[OptionsValidator]
public sealed partial class AuthOptionsValidator : IValidateOptions<AuthOptions>;

/// <summary>Environment-dependent checks use explicit registration alongside the generated value validator.</summary>
public sealed class AuthEnvironmentValidator(string environment) : IValidateOptions<AuthOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthOptions options) => options.Mode switch
    {
        AuthMode.Development when environment != "Development" => ValidateOptionsResult.Fail("Auth:Mode=Development is permitted only in Development."),
        AuthMode.None when environment != "SystemTest" => ValidateOptionsResult.Fail("Auth:Mode=None is permitted only in SystemTest."),
        _ => ValidateOptionsResult.Success,
    };
}

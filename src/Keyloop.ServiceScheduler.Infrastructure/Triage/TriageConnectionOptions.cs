using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Outbound configuration. Disabled by default; the token is supplied only by the platform.</summary>
public sealed class TriageConnectionOptions : IValidatableObject
{
    public const string SectionName = "Triage";
    public bool Enabled { get; set; }
    public string AccountId { get; set; } = "";
    public string ApiToken { get; set; } = "";
    public string GatewayId { get; set; } = "keyloop-scheduler";
    public string Model { get; set; } = "@cf/cloudflare/clef-flash";
    public string BaseUrl { get; set; } = "https://api.cloudflare.com/client/v4";
    public bool ImagesEnabled { get; set; } = true;
    public string ImageStoreUrl { get; set; } = "";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(4);

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Enabled && (AccountId.Length != 32 || !AccountId.All(Uri.IsHexDigit)))
        {
            yield return new("AccountId must contain 32 hexadecimal characters when enabled.", [nameof(AccountId)]);
        }

        if (Enabled && (string.IsNullOrWhiteSpace(ApiToken) || ApiToken.Any(char.IsWhiteSpace) || ApiToken.Any(char.IsControl)))
        {
            yield return new("ApiToken is required and must contain no whitespace or control characters when enabled.", [nameof(ApiToken)]);
        }

        if (string.IsNullOrWhiteSpace(GatewayId) || GatewayId.Length > 64 || !GatewayId.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))
        {
            yield return new("GatewayId must be a gateway slug of at most 64 characters.", [nameof(GatewayId)]);
        }

        if (Model is not ("@cf/cloudflare/clef-flash" or "@cf/cloudflare/clef"))
        {
            yield return new("Model must be @cf/cloudflare/clef-flash or @cf/cloudflare/clef.", [nameof(Model)]);
        }

        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment))
        {
            yield return new("BaseUrl must be an absolute HTTPS URL without credentials, query or fragment.", [nameof(BaseUrl)]);
        }

        if (ImageStoreUrl.Length > 0 && ImageStoreUrl != "http://triage-media.internal")
        {
            yield return new("ImageStoreUrl must be the private Cloudflare container relay or empty for transient local storage.", [nameof(ImageStoreUrl)]);
        }

        if (Timeout < TimeSpan.FromMilliseconds(100) || Timeout > TimeSpan.FromSeconds(10))
        {
            yield return new("Timeout must be between 100 milliseconds and ten seconds.", [nameof(Timeout)]);
        }
    }
}

[OptionsValidator]
public sealed partial class TriageConnectionOptionsValidator : IValidateOptions<TriageConnectionOptions>;

using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Keyloop.ServiceScheduler.Api.Common.Options;

public enum NotificationProvider { None, Smtp, Cloudflare }
public enum SmtpEncryption { None, StartTls }

public sealed class NotificationOptions : IValidatableObject
{
    public const string SectionName = "Notifications";
    public bool Enabled { get; set; }
    public NotificationProvider Provider { get; set; }
    public string FromAddress { get; set; } = "notifications@keyloop.example";
    public string FromDisplayName { get; set; } = "Keyloop Service Scheduler";
    public string? ReplyTo { get; set; }
    [Range(typeof(TimeSpan), "00:00:00.100", "00:10:00", ParseLimitsInInvariantCulture = true, ConvertValueInInvariantCulture = true)]
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromSeconds(5);
    [Range(1, 100)]
    public int BatchSize { get; set; } = 10;
    [Range(1, 20)]
    public int MaxAttempts { get; set; } = 5;
    [Range(typeof(TimeSpan), "00:00:00.100", "1.00:00:00", ParseLimitsInInvariantCulture = true, ConvertValueInInvariantCulture = true)]
    public TimeSpan InitialBackoff { get; set; } = TimeSpan.FromSeconds(10);
    [Range(typeof(TimeSpan), "00:00:00.100", "7.00:00:00", ParseLimitsInInvariantCulture = true, ConvertValueInInvariantCulture = true)]
    public TimeSpan MaxBackoff { get; set; } = TimeSpan.FromHours(1);
    [Range(typeof(TimeSpan), "00:00:01", "00:05:00", ParseLimitsInInvariantCulture = true, ConvertValueInInvariantCulture = true)]
    public TimeSpan SendTimeout { get; set; } = TimeSpan.FromSeconds(30);
    [Range(typeof(TimeSpan), "00:00:02", "00:30:00", ParseLimitsInInvariantCulture = true, ConvertValueInInvariantCulture = true)]
    public TimeSpan ClaimLease { get; set; } = TimeSpan.FromMinutes(2);
    [ValidateObjectMembers]
    public SmtpNotificationOptions Smtp { get; set; } = new();
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Provider is not (NotificationProvider.None or NotificationProvider.Smtp or NotificationProvider.Cloudflare))
        {
            yield return new ValidationResult("Provider must be None, Smtp or Cloudflare.", [nameof(Provider)]);
        }
        if (Enabled && Provider == NotificationProvider.None)
        {
            yield return new ValidationResult("Enabled notifications require a sender provider.", [nameof(Enabled), nameof(Provider)]);
        }
        if (!IsAddress(FromAddress))
        {
            yield return new ValidationResult("FromAddress must be a single email address without display text or line breaks.", [nameof(FromAddress)]);
        }
        if (string.IsNullOrWhiteSpace(FromDisplayName) || HasLineBreak(FromDisplayName))
        {
            yield return new ValidationResult("FromDisplayName must be non-empty and contain no line breaks.", [nameof(FromDisplayName)]);
        }
        if (ReplyTo is not null && !IsAddress(ReplyTo))
        {
            yield return new ValidationResult("ReplyTo must be a single email address without display text or line breaks.", [nameof(ReplyTo)]);
        }
        if (MaxBackoff < InitialBackoff)
        {
            yield return new ValidationResult("MaxBackoff must be at least InitialBackoff.", [nameof(MaxBackoff)]);
        }
        if (ClaimLease <= SendTimeout + TimeSpan.FromSeconds(5))
        {
            yield return new ValidationResult("ClaimLease must exceed SendTimeout by more than five seconds.", [nameof(ClaimLease)]);
        }
    }

    private static bool HasLineBreak(string value) => value.Contains('\r') || value.Contains('\n');
    private static bool IsAddress(string value) => !string.IsNullOrWhiteSpace(value) && !HasLineBreak(value)
        && MailboxAddress.TryParse(value, out var mailbox) && mailbox.Address == value && value.Contains('@');
}

public sealed class SmtpNotificationOptions : IValidatableObject
{
    [Required]
    public string Host { get; set; } = "localhost";
    [Range(1, 65535)]
    public int Port { get; set; } = 1025;
    public SmtpEncryption Encryption { get; set; } = SmtpEncryption.None;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Encryption is not (SmtpEncryption.None or SmtpEncryption.StartTls))
        {
            yield return new ValidationResult("Encryption must be None or StartTls.", [nameof(Encryption)]);
        }
        if (string.IsNullOrEmpty(Username) != string.IsNullOrEmpty(Password))
        {
            yield return new ValidationResult("SMTP credentials must supply both Username and Password.", [nameof(Username), nameof(Password)]);
        }
    }
}

[OptionsValidator]
public sealed partial class NotificationOptionsValidator : IValidateOptions<NotificationOptions>;

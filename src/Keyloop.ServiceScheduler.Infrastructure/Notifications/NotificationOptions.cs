using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

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
    /// <summary>The longest the dispatcher sleeps when nothing nudges it and nothing is due (it also wakes on commits and due times).</summary>
    public TimeSpan IdleInterval { get; set; } = TimeSpan.FromMinutes(15);
    [Range(1, 100)]
    public int BatchSize { get; set; } = 10;
    [Range(1, 20)]
    public int MaxAttempts { get; set; } = 5;
    public TimeSpan InitialBackoff { get; set; } = TimeSpan.FromSeconds(10);
    public TimeSpan MaxBackoff { get; set; } = TimeSpan.FromHours(1);
    public TimeSpan SendTimeout { get; set; } = TimeSpan.FromSeconds(30);
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
        // Typed comparisons, not [Range(typeof(TimeSpan), ...)]: that constructor converts through a TypeConverter, which is not
        // trim-safe (IL2026; ledger ruling under Task 18/18a). The generated validator calls this method.
        if (OutOfRange(IdleInterval, TimeSpan.FromSeconds(1), TimeSpan.FromHours(1)))
        {
            yield return new ValidationResult("IdleInterval must be between 00:00:01 and 01:00:00.", [nameof(IdleInterval)]);
        }
        if (OutOfRange(InitialBackoff, TimeSpan.FromMilliseconds(100), TimeSpan.FromDays(1)))
        {
            yield return new ValidationResult("InitialBackoff must be between 00:00:00.100 and 1.00:00:00.", [nameof(InitialBackoff)]);
        }
        if (OutOfRange(MaxBackoff, TimeSpan.FromMilliseconds(100), TimeSpan.FromDays(7)))
        {
            yield return new ValidationResult("MaxBackoff must be between 00:00:00.100 and 7.00:00:00.", [nameof(MaxBackoff)]);
        }
        if (OutOfRange(SendTimeout, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(5)))
        {
            yield return new ValidationResult("SendTimeout must be between 00:00:01 and 00:05:00.", [nameof(SendTimeout)]);
        }
        if (OutOfRange(ClaimLease, TimeSpan.FromSeconds(2), TimeSpan.FromMinutes(30)))
        {
            yield return new ValidationResult("ClaimLease must be between 00:00:02 and 00:30:00.", [nameof(ClaimLease)]);
        }
        if (MaxBackoff < InitialBackoff)
        {
            yield return new ValidationResult("MaxBackoff must be at least InitialBackoff.", [nameof(MaxBackoff)]);
        }
        // The margin covers the bounded acknowledgement after a send (NotificationDispatcher.AcknowledgementTimeout, five seconds).
        if (ClaimLease <= SendTimeout + TimeSpan.FromSeconds(5))
        {
            yield return new ValidationResult("ClaimLease must exceed SendTimeout by more than five seconds.", [nameof(ClaimLease)]);
        }
    }

    private static bool OutOfRange(TimeSpan value, TimeSpan minimum, TimeSpan maximum) => value < minimum || value > maximum;

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

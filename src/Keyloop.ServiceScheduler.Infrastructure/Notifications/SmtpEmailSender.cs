using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// One MailKit connection per send, safe for parallel claims. STARTTLS requires TLS rather than silently falling back. Besides the
/// provider-neutral <see cref="EmailMessage.NotificationIdHeader"/>, SMTP gets a Message-Id derived from the same outbox id, so every
/// attempt of one notification carries the same one (a correlation reference, not an SMTP deduplication guarantee).
/// </summary>
public sealed class SmtpEmailSender(IOptions<NotificationOptions> options, TimeProvider timeProvider) : IEmailSender
{
    private readonly NotificationOptions _options = options.Value;

    /// <summary>The SMTP Message-Id (without angle brackets) of every attempt of one notification.</summary>
    public static string MessageIdFor(Guid notificationId) => $"{notificationId:N}@service-scheduler.keyloop.example";

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        using var mime = new MimeMessage
        {
            Subject = message.Subject,
            MessageId = MessageIdFor(message.NotificationId),
            Date = timeProvider.GetUtcNow(),
            Body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody }.ToMessageBody(),
        };
        mime.Headers.Add(EmailMessage.NotificationIdHeader, message.NotificationId.ToString("D"));
        // RFC 3834: an automatic message, so auto-responders (out-of-office replies) stay quiet.
        mime.Headers.Add("Auto-Submitted", "auto-generated");
        mime.From.Add(new MailboxAddress(_options.FromDisplayName, _options.FromAddress));
        mime.To.Add(MailboxAddress.Parse(message.Recipient));
        if (_options.ReplyTo is { } replyTo)
        {
            mime.ReplyTo.Add(MailboxAddress.Parse(replyTo));
        }
        using var client = new SmtpClient { Timeout = (int)_options.SendTimeout.TotalMilliseconds };
        var smtp = _options.Smtp;
        await client.ConnectAsync(smtp.Host, smtp.Port, smtp.Encryption == SmtpEncryption.StartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.None, cancellationToken);
        if (smtp.Username is { Length: > 0 } username)
        {
            await client.AuthenticateAsync(username, smtp.Password ?? throw new InvalidOperationException("SMTP Password is required with Username."), cancellationToken);
        }
        await client.SendAsync(mime, cancellationToken);
        // Dispose closes the connection. A failure sending QUIT after acceptance must not turn a successful send into a retry.
    }
}

/// <summary>None is an explicit off switch, never a sender that silently drops mail.</summary>
public sealed class DisabledEmailSender : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("Notifications:Provider=None cannot send email.");
}

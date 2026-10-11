using Keyloop.ServiceScheduler.Api.Common.Options;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

/// <summary>One MailKit connection per send, safe for parallel claims. STARTTLS requires TLS rather than silently falling back.</summary>
public sealed class SmtpEmailSender(IOptions<NotificationOptions> options, TimeProvider timeProvider) : IEmailSender
{
    private readonly NotificationOptions _options = options.Value;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        using var mime = new MimeMessage
        {
            Subject = message.Subject,
            MessageId = message.MessageId,
            Date = timeProvider.GetUtcNow(),
            Body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody }.ToMessageBody(),
        };
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
internal sealed class DisabledEmailSender : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("Notifications:Provider=None cannot send email.");
}

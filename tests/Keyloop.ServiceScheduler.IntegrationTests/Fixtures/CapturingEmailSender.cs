using System.Collections.Concurrent;
using Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

public sealed class CapturingEmailSender : IEmailSender
{
    private readonly ConcurrentQueue<EmailMessage> _messages = new();
    public IReadOnlyList<EmailMessage> Messages => _messages.ToArray();
    public Func<EmailMessage, CancellationToken, Task>? OnSend { get; set; }
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        _messages.Enqueue(message);
        if (OnSend is not null)
        {
            await OnSend(message, cancellationToken);
        }
    }
}

using System.Text.Json;
using DotNet.Testcontainers.Builders;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.IntegrationTests.Notifications;

public sealed class SmtpEmailSenderTests
{
    [Fact]
    public async Task Mailpit_receives_subject_recipient_both_parts_and_the_correlation_headers_over_smtp()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var mailpit = new ContainerBuilder("axllent/mailpit:v1.31.5")
            .WithPortBinding(1025, true).WithPortBinding(8025, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(8025).ForPath("/readyz")))
            .Build();
        await mailpit.StartAsync(ct);
        using var http = new HttpClient { BaseAddress = new Uri($"http://{mailpit.Hostname}:{mailpit.GetMappedPublicPort(8025)}") };
        await WaitForHttpAsync(http, ct);
        var options = new NotificationOptions
        {
            Enabled = true, Provider = NotificationProvider.Smtp, FromAddress = "notifications@keyloop.example", ReplyTo = "support@keyloop.example",
            Smtp = new SmtpNotificationOptions { Host = mailpit.Hostname, Port = mailpit.GetMappedPublicPort(1025), Encryption = SmtpEncryption.None },
        };
        var id = Guid.NewGuid();
        var message = NotificationTemplate.Render(id, NotificationKind.BookingConfirmation,
            new NotificationDetails(Guid.NewGuid(), TestData.DeliverableEmail(), "Test Motors", "Interim service", "Europe/London",
                TestData.LondonTime(9), TestData.LondonTime(10), "AB12 CDE", "3456"));
        await new SmtpEmailSender(Options.Create(options), TestData.Clock()).SendAsync(message, ct);
        using var list = JsonDocument.Parse(await http.GetStringAsync("/api/v1/messages", ct));
        list.RootElement.GetProperty("total").GetInt32().ShouldBe(1);
        var summary = list.RootElement.GetProperty("messages")[0];
        summary.GetProperty("Subject").GetString().ShouldBe(message.Subject);
        summary.GetProperty("To")[0].GetProperty("Address").GetString().ShouldBe(message.Recipient);
        var mailpitId = summary.GetProperty("ID").GetString();
        using var detail = JsonDocument.Parse(await http.GetStringAsync($"/api/v1/message/{mailpitId}", ct));
        detail.RootElement.GetProperty("Text").GetString()!.Replace("\r\n", "\n", StringComparison.Ordinal).ShouldBe(message.TextBody.Replace("\r\n", "\n", StringComparison.Ordinal));
        detail.RootElement.GetProperty("HTML").GetString().ShouldBe(message.HtmlBody);
        var raw = await http.GetStringAsync($"/api/v1/message/{mailpitId}/raw", ct);
        raw.ShouldContain($"X-Keyloop-Notification-Id: {id:D}", Case.Insensitive);
        raw.ShouldContain("Auto-Submitted: auto-generated", Case.Insensitive);
        raw.ShouldContain($"Message-Id: <{id:N}@service-scheduler.keyloop.example>", Case.Insensitive);
        raw.ShouldContain("multipart/alternative");
        raw.ShouldContain("support@keyloop.example");
        raw.ShouldContain("Keyloop Service Scheduler");
        raw.ShouldNotContain("WVWZZZ");
    }

    private static async Task WaitForHttpAsync(HttpClient http, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            try
            {
                using var response = await http.GetAsync("/readyz", timeout.Token);
                response.EnsureSuccessStatusCode();
                return;
            }
            catch (HttpRequestException)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
            }
        }
    }
}

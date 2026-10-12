using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Keyloop.ServiceScheduler.Infrastructure.Telemetry;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>One interactive evaluation, at most one short retry, under one total timeout. No upstream error text is retained.</summary>
public sealed class CloudflareTriageClient(HttpClient http, IOptions<TriageConnectionOptions> options,
    TimeProvider clock, ILogger<CloudflareTriageClient> logger)
{
    public async Task<ClefEvaluation> EvaluateAsync(ClefRequest input, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(input);
        var settings = options.Value;
        if (!settings.Enabled)
        {
            throw new TriageUnavailableException("disabled");
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(settings.Timeout);
        try
        {
            for (var attempt = 0; ; attempt++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Post,
                    $"{settings.BaseUrl.TrimEnd('/')}/accounts/{settings.AccountId}/ai/run/{settings.Model}");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiToken);
                request.Headers.Add("cf-aig-gateway-id", settings.GatewayId);
                request.Headers.Add("cf-aig-collect-log", "false");
                request.Headers.Add("cf-aig-skip-cache", "true");
                // Bound retries here and prevent a configured gateway retry from multiplying our attempts.
                request.Headers.Add("cf-aig-max-attempts", "1");
                request.Content = JsonContent.Create(input, TriageJsonContext.Transport.ClefRequest);
                using var response = await http.SendAsync(request, deadline.Token);
                if (response.IsSuccessStatusCode)
                {
                    ClefEnvelope? envelope;
                    try
                    {
                        envelope = await response.Content.ReadFromJsonAsync(TriageJsonContext.Default.ClefEnvelope, deadline.Token);
                    }
                    // The JSON reader wraps an unsupported Content-Type charset's ArgumentException.
                    catch (InvalidOperationException ex) when (ex.InnerException is ArgumentException && response.Content.Headers.ContentType?.CharSet is not null)
                    {
                        throw new TriageUnavailableException("invalid-answer");
                    }
                    return ClefAnswerValidator.Validate(envelope, input);
                }
                var retry = RetryDelay(response.Headers.RetryAfter);
                if (attempt == 0 && IsTransient(response.StatusCode) && (retry is null || retry <= TimeSpan.FromSeconds(1)))
                {
                    logger.TriageRetry((int)response.StatusCode);
                    await Task.Delay(retry ?? TimeSpan.FromMilliseconds(150), deadline.Token);
                    continue;
                }
                throw new TriageUnavailableException(Reason(response.StatusCode),
                    retry is { } delay ? (int)Math.Min(int.MaxValue, Math.Ceiling(delay.TotalSeconds)) : null);
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.TriageUnavailable("timeout");
            throw new TriageUnavailableException("timeout");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or JsonException or NotSupportedException)
        {
            var reason = ex is HttpRequestException or IOException ? "transport" : "invalid-answer";
            logger.TriageUnavailable(reason);
            throw new TriageUnavailableException(reason);
        }
        catch (TriageUnavailableException ex)
        {
            logger.TriageUnavailable(ex.Reason);
            throw;
        }
    }

    private TimeSpan? RetryDelay(RetryConditionHeaderValue? retry) => retry?.Delta ??
        (retry?.Date is { } date ? TimeSpan.FromSeconds(Math.Max(0, (date - clock.GetUtcNow()).TotalSeconds)) : null);
    private static bool IsTransient(HttpStatusCode status) => status == HttpStatusCode.TooManyRequests || (int)status >= 500;
    private static string Reason(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "authentication",
        HttpStatusCode.TooManyRequests => "rate-limited",
        HttpStatusCode.PaymentRequired => "billing",
        _ => (int)status >= 500 ? "upstream" : "upstream-rejected",
    };
}

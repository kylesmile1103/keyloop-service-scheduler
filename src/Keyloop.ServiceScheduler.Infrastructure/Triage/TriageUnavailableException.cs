namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Safe categories only: never retains an upstream body, exception, token or customer description.</summary>
public sealed class TriageUnavailableException(string reason, int? retryAfterSeconds = null)
    : Exception("Service suggestions are temporarily unavailable. Please select a service manually.")
{
    public string Reason { get; } = reason;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}

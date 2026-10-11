namespace Keyloop.ServiceScheduler.Api.Infrastructure.Notifications;

public static class NotificationBackoff
{
    /// <summary>Initial * 2^(attempt-1), plus 0-20 percent jitter, capped including jitter. Attempt is one-based.</summary>
    public static TimeSpan Delay(int attempt, TimeSpan initial, TimeSpan maximum, double jitter)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(attempt, 1);
        if (double.IsNaN(jitter) || jitter is < 0 or > 1)
        {
            throw new ArgumentOutOfRangeException(nameof(jitter));
        }
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(initial, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfLessThan(maximum, initial);
        var milliseconds = initial.TotalMilliseconds * Math.Pow(2, attempt - 1) * (1 + 0.2 * jitter);
        return TimeSpan.FromMilliseconds(Math.Min(maximum.TotalMilliseconds, milliseconds));
    }
}

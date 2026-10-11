namespace Keyloop.ServiceScheduler.Api.Domain.Catalog;

public readonly record struct ServiceDuration
{
    private ServiceDuration(int minutes) => Minutes = minutes;

    public int Minutes { get; }

    public TimeSpan AsTimeSpan => TimeSpan.FromMinutes(Minutes);

    public static ServiceDuration Create(int minutes)
    {
        if (minutes <= 0 || minutes % 5 != 0 || minutes > 480)
        {
            throw new ArgumentOutOfRangeException(nameof(minutes), minutes, "Duration must be a positive multiple of 5 minutes, at most 480.");
        }

        return new ServiceDuration(minutes);
    }
}

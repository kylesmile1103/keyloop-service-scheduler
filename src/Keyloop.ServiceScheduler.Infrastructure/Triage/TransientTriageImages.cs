namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Bounded local/test equivalent of R2. Never registered as persistent application data.</summary>
public sealed class TransientTriageImages(TimeProvider clock)
{
    private readonly object _gate = new();
    private readonly Dictionary<(Guid Dealership, Guid Image), StoredTriageImage> _images = [];

    public const long CapacityBytes = 64 * 1024 * 1024;

    /// <summary>False when the unexpired images already held leave no room for this one.</summary>
    public bool TryPut(Guid dealership, Guid id, StoredTriageImage image)
    {
        ArgumentNullException.ThrowIfNull(image);
        lock (_gate)
        {
            Prune();
            if (_images.Values.Sum(value => (long)value.Bytes.Length) + image.Bytes.Length > CapacityBytes)
            {
                return false;
            }

            _images[(dealership, id)] = image;
            return true;
        }
    }

    public StoredTriageImage? Get(Guid dealership, Guid id)
    {
        lock (_gate)
        {
            Prune();
            return _images.GetValueOrDefault((dealership, id));
        }
    }

    private void Prune()
    {
        var now = clock.GetUtcNow();
        foreach (var key in _images.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
        {
            _images.Remove(key);
        }
    }
}

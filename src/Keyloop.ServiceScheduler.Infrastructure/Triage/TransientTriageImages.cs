namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Bounded local/test equivalent of R2. Never registered as persistent application data.</summary>
public sealed class TransientTriageImages(TimeProvider clock)
{
    private readonly object _gate = new();
    private readonly Dictionary<(Guid Dealership, Guid Image), StoredTriageImage> _images = [];

    public void Put(Guid dealership, Guid id, StoredTriageImage image)
    {
        lock (_gate)
        {
            Prune();
            if (_images.Values.Sum(value => (long)value.Bytes.Length) + image.Bytes.Length > 64 * 1024 * 1024)
            {
                throw new TriageUnavailableException("image-capacity");
            }

            _images[(dealership, id)] = image;
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

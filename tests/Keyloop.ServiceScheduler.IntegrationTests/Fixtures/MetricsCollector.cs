using System.Collections.Concurrent;
using System.Globalization;
using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Records every measurement of the scheduler's own instruments (<see cref="SchedulerTelemetry.Meter"/>) from construction to
/// disposal. The meter is static and the listener process-wide, so this sees every host in the test process; the integration tests
/// run one class at a time (<c>ParallelMode.None</c>), so a collector created by a test sees only that test's work.
/// </summary>
public sealed class MetricsCollector : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly ConcurrentQueue<Measurement> _measurements = new();

    public MetricsCollector()
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (ReferenceEquals(instrument.Meter, SchedulerTelemetry.Meter))
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };
        _listener.SetMeasurementEventCallback<long>((instrument, value, tags, _) => Record(instrument, value, tags));
        _listener.SetMeasurementEventCallback<double>((instrument, value, tags, _) => Record(instrument, value, tags));
        _listener.SetMeasurementEventCallback<int>((instrument, value, tags, _) => Record(instrument, value, tags));
        _listener.Start();
    }

    public sealed record Measurement(string Instrument, double Value, KeyValuePair<string, object?>[] Tags)
    {
        public object? Tag(string key) => Tags.FirstOrDefault(t => t.Key == key).Value;
    }

    /// <summary>A tag filter for <see cref="Sum"/>, <see cref="Max"/> and <see cref="Of"/>: the tag is present with this value (compared as text).</summary>
    public static Func<KeyValuePair<string, object?>[], bool> Tag(string key, object value) =>
        tags => tags.Any(t => t.Key == key && string.Equals(Convert.ToString(t.Value, System.Globalization.CultureInfo.InvariantCulture), Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));

    /// <summary>The measurements of <paramref name="instrument"/> (e.g. <c>scheduler.booking.requests</c>) whose tags pass <paramref name="tagFilter"/>.</summary>
    public IReadOnlyList<Measurement> Of(string instrument, Func<KeyValuePair<string, object?>[], bool>? tagFilter = null) =>
        [.. _measurements.Where(m => m.Instrument == instrument && (tagFilter?.Invoke(m.Tags) ?? true))];

    /// <summary>The sum of a counter's increments (or of a histogram's recorded values).</summary>
    public long Sum(string instrument, Func<KeyValuePair<string, object?>[], bool>? tagFilter = null) => (long)Of(instrument, tagFilter).Sum(m => m.Value);

    /// <summary>The largest recorded value, or 0 when nothing was recorded.</summary>
    public double Max(string instrument, Func<KeyValuePair<string, object?>[], bool>? tagFilter = null) =>
        Of(instrument, tagFilter).Select(m => m.Value).DefaultIfEmpty(0).Max();

    /// <summary>Asks every observable instrument (the gauges) for its current value, which is then recorded like any measurement.</summary>
    public void Observe() => _listener.RecordObservableInstruments();

    public void Dispose()
    {
        _listener.Dispose();
        // Optional raw timing evidence for local contention comparisons, outside the measured request path.
        if (Environment.GetEnvironmentVariable("KEYLOOP_TEST_METRICS_DIRECTORY") is { Length: > 0 } directory)
        {
            Directory.CreateDirectory(directory);
            File.WriteAllLines(Path.Combine(directory, $"{Guid.NewGuid():N}.csv"),
                _measurements.Select(m => string.Create(CultureInfo.InvariantCulture, $"{m.Instrument},{m.Value:R}")));
        }
    }

    private void Record(Instrument instrument, double value, ReadOnlySpan<KeyValuePair<string, object?>> tags) =>
        _measurements.Enqueue(new Measurement(instrument.Name, value, tags.ToArray()));
}

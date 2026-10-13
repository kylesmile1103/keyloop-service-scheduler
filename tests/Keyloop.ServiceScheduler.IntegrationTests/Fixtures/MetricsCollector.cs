using System.Collections.Concurrent;
using System.Globalization;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// Records every measurement of the scheduler's own instruments (<see cref="SchedulerTelemetry.Meter"/>) from construction to
/// disposal. Dealership filters use test-only span correlation while Tags retain the raw exported labels, so the unchanged
/// contention assertions remain meaningful without unbounded metric labels. The meter is static and the listener process-wide, so this sees every host in the test process; the integration tests
/// run one class at a time (<c>ParallelMode.None</c>), so a collector created by a test sees only that test's work.
/// </summary>
public sealed class MetricsCollector : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly ActivityListener _activities = new()
    {
        ShouldListenTo = source => source.Name is SchedulerTelemetry.Name or "Microsoft.AspNetCore",
        Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
    };
    private readonly ConcurrentQueue<Measurement> _measurements = new();

    public MetricsCollector()
    {
        ActivitySource.AddActivityListener(_activities);
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
        // Test-only correlation from Activity.Current, separate from the instrument's raw exported Tags.
        internal string? ContextDealershipId { get; init; }
        internal KeyValuePair<string, object?>[] FilterTags => ContextDealershipId is { } id && !Tags.Any(t => t.Key == "dealership.id")
            ? [.. Tags, new("dealership.id", id)] : Tags;

        public object? Tag(string key) => Tags.FirstOrDefault(t => t.Key == key).Value;
    }

    /// <summary>A tag filter for <see cref="Sum"/>, <see cref="Max"/> and <see cref="Of"/>: the tag is present with this value (compared as text).</summary>
    public static Func<KeyValuePair<string, object?>[], bool> Tag(string key, object value) =>
        tags => tags.Any(t => t.Key == key && string.Equals(Convert.ToString(t.Value, System.Globalization.CultureInfo.InvariantCulture), Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));

    /// <summary>The measurements of <paramref name="instrument"/> (e.g. <c>scheduler.booking.requests</c>) whose tags pass <paramref name="tagFilter"/>.</summary>
    public IReadOnlyList<Measurement> Of(string instrument, Func<KeyValuePair<string, object?>[], bool>? tagFilter = null) =>
        [.. _measurements.Where(m => m.Instrument == instrument && (tagFilter?.Invoke(m.FilterTags) ?? true))];

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
        _activities.Dispose();
        // Optional raw timing evidence for local contention comparisons, outside the measured request path.
        if (Environment.GetEnvironmentVariable("KEYLOOP_TEST_METRICS_DIRECTORY") is { Length: > 0 } directory)
        {
            Directory.CreateDirectory(directory);
            File.WriteAllLines(Path.Combine(directory, $"{Guid.NewGuid():N}.csv"),
                _measurements.Select(m => string.Create(CultureInfo.InvariantCulture, $"{m.Instrument},{m.Value:R}")));
        }
    }

    private void Record(Instrument instrument, double value, ReadOnlySpan<KeyValuePair<string, object?>> tags)
    {
        string? dealership = null;
        for (var activity = Activity.Current; activity is not null; activity = activity.Parent)
        {
            if (activity.GetTagItem("dealership.id") is string id) { dealership = id; break; }
        }
        _measurements.Enqueue(new Measurement(instrument.Name, value, tags.ToArray()) { ContextDealershipId = dealership });
    }
}

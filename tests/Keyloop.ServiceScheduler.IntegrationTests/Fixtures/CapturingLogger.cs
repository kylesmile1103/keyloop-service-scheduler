using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>An <see cref="ILogger{T}"/> that records every entry, for asserting event ids, levels and attached exceptions.</summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly List<Entry> _entries = [];

    public IReadOnlyList<Entry> Entries
    {
        get
        {
            lock (_entries)
            {
                return [.. _entries];
            }
        }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        lock (_entries)
        {
            _entries.Add(new Entry(logLevel, eventId, formatter(state, exception), exception));
        }
    }

    public sealed record Entry(LogLevel Level, EventId EventId, string Message, Exception? Exception);
}

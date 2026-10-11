using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Captures every log entry of a host (register with <c>services.AddSingleton&lt;ILoggerProvider&gt;(provider)</c>).</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
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

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public void Dispose()
    {
    }

    public sealed record Entry(string Category, LogLevel Level, EventId EventId, string Message, Exception? Exception, IReadOnlyList<KeyValuePair<string, object?>> State);

    private sealed class Logger(CapturingLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (provider._entries)
            {
                provider._entries.Add(new Entry(category, logLevel, eventId, formatter(state, exception), exception, state is IEnumerable<KeyValuePair<string, object?>> properties ? properties.ToArray() : []));
            }
        }
    }
}

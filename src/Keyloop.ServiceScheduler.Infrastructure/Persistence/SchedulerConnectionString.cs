using Npgsql;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Validates the <c>schedulerdb</c> connection string at startup without echoing credentials in exception messages.
/// </summary>
public static class SchedulerConnectionString
{
    public const string Name = "schedulerdb";

    /// <exception cref="InvalidOperationException">The value is missing or is not an Npgsql keyword connection string.</exception>
    public static void Validate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"Connection string '{Name}' is missing.");
        }

        try
        {
            _ = new NpgsqlConnectionStringBuilder(value);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or InvalidCastException or OverflowException or KeyNotFoundException)
        {
            // Deliberately no inner exception: its message repeats the value.
            throw new InvalidOperationException(
                $"Connection string '{Name}' is not an Npgsql keyword connection string such as Host=...;Database=...;Username=...;Password=...; "
                + "PostgreSQL URIs (postgresql://...) are not accepted. The value is not shown.");
        }
    }
}

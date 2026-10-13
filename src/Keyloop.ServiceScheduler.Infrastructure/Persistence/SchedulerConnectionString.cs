using Npgsql;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>
/// Parses the <c>schedulerdb</c> connection string during the composition root's startup check (Program.cs), before any database
/// work. Npgsql otherwise parses it on first use, and its <see cref="ArgumentException"/> quotes the whole value, password included,
/// which the runtime then prints as the unhandled exception: a PostgreSQL URI (<c>postgresql://user:password@host/db</c>, the form
/// Neon shows by default) reached the container log that way. The replacement message names the expected form, never the value.
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

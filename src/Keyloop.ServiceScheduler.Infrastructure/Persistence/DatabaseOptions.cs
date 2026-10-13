namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>Startup database behaviour per environment. Both default to off; Development turns both on.</summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>Apply pending EF Core migrations at startup (Development, SystemTest, Demo). UAT and Production use migration bundles.</summary>
    public bool MigrateOnStartup { get; set; }

    /// <summary>Seed the reference catalogue (two dealerships, their bays, technicians and the service types) and a week of demo appointments.</summary>
    public bool SeedDemoData { get; set; }
}


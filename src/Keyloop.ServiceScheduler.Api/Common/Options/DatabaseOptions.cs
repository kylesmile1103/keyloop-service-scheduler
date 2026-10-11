namespace Keyloop.ServiceScheduler.Api.Common.Options;

/// <summary>Startup database behaviour per environment (SYSTEM_DESIGN §10). Both default to off; Development turns both on.</summary>
/// <remarks>
/// No <c>[OptionsValidator]</c>: the generator rejects a type with nothing to validate (SYSLIB1203). <c>ValidateOnStart()</c> still
/// binds it at startup, so a malformed value fails the boot rather than the first use.
/// </remarks>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>Apply pending EF Core migrations at startup (Development, SystemTest, Demo). UAT and Production use migration bundles.</summary>
    public bool MigrateOnStartup { get; set; }

    /// <summary>Seed the reference catalogue (two dealerships, their bays, technicians and the service types) and a week of demo appointments.</summary>
    public bool SeedDemoData { get; set; }
}


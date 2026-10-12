using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.UnitTests.Architecture;

public class AssemblyDependencyTests
{
    [Fact]
    public void Domain_has_no_persistence_web_or_outer_assembly_dependencies()
    {
        string[] forbiddenPrefixes =
        [
            "Microsoft.EntityFrameworkCore",
            "Microsoft.AspNetCore",
            "Npgsql",
            "Keyloop.ServiceScheduler.Infrastructure",
            "Keyloop.ServiceScheduler.Api",
        ];

        typeof(Appointment).Assembly.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => forbiddenPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)))
            .ShouldBeEmpty("Domain must remain independent of persistence, web and outer assemblies (ADR-025).");
    }

    [Fact]
    public void Infrastructure_has_no_Api_assembly_dependency()
    {
        typeof(SchedulerDbContext).Assembly.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => name.StartsWith("Keyloop.ServiceScheduler.Api", StringComparison.Ordinal))
            .ShouldBeEmpty("Infrastructure must not depend on its Api host (ADR-025).");
    }
}

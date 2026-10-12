using System.Xml.Linq;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.UnitTests.Architecture;

/// <summary>
/// The assembly boundaries of ADR-025. Compiled references show what code uses, but the compiler drops a reference
/// no code uses, so the project files are checked as well: declaring a reference is a boundary change before any
/// code depends on it. Reverse references (Domain to Infrastructure or Api) are already a build-time project cycle.
/// </summary>
public class AssemblyDependencyTests
{
    private const string DomainProject = "src/Keyloop.ServiceScheduler.Domain/Keyloop.ServiceScheduler.Domain.csproj";
    private const string InfrastructureProject = "src/Keyloop.ServiceScheduler.Infrastructure/Keyloop.ServiceScheduler.Infrastructure.csproj";

    [Fact]
    public void Domain_references_only_the_base_class_library()
    {
        typeof(Appointment).Assembly.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => !IsBaseClassLibrary(name))
            .ShouldBeEmpty("Domain may use only the .NET base class library: no persistence, web, mail, hosting or outer assembly (ADR-025).");
    }

    [Fact]
    public void Domain_project_declares_no_package_project_or_framework_reference()
    {
        References(DomainProject, "PackageReference", "ProjectReference", "FrameworkReference")
            .ShouldBeEmpty("Domain must not declare any package, project or framework reference (ADR-025).");
    }

    [Fact]
    public void Infrastructure_has_no_web_host_or_Api_assembly_dependency()
    {
        string[] forbiddenPrefixes =
        [
            "Microsoft.AspNetCore",
            "Keyloop.ServiceScheduler.Api",
            "Keyloop.ServiceScheduler.ServiceDefaults",
        ];

        typeof(SchedulerDbContext).Assembly.GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => forbiddenPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)))
            .ShouldBeEmpty("Infrastructure must not depend on ASP.NET Core, the service defaults or its Api host (ADR-025).");
    }

    [Fact]
    public void Infrastructure_project_references_only_Domain_and_no_framework()
    {
        References(InfrastructureProject, "ProjectReference", "FrameworkReference")
            .ShouldBe(["ProjectReference ..\\Keyloop.ServiceScheduler.Domain\\Keyloop.ServiceScheduler.Domain.csproj"],
                "Infrastructure references Domain only and no shared framework such as ASP.NET Core (ADR-025).");
    }

    private static bool IsBaseClassLibrary(string name) =>
        name is "System" or "netstandard" or "mscorlib" || name.StartsWith("System.", StringComparison.Ordinal);

    /// <summary>"Kind Include" for every reference item of the given kinds declared in a project file.</summary>
    private static string[] References(string project, params string[] kinds)
    {
        var path = Path.Combine(RepositoryRoot(), project);
        return [.. XDocument.Load(path).Descendants()
            .Where(element => kinds.Contains(element.Name.LocalName))
            .Select(element => $"{element.Name.LocalName} {element.Attribute("Include")?.Value}")];
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Keyloop.ServiceScheduler.sln")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException($"No Keyloop.ServiceScheduler.sln above {AppContext.BaseDirectory}.");
    }
}

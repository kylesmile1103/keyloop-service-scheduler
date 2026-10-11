using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;

/// <summary>Used by <c>dotnet ef</c>, so adding a migration needs neither a database nor the application host.</summary>
public sealed class SchedulerDbContextDesignTimeFactory : IDesignTimeDbContextFactory<SchedulerDbContext>
{
    public SchedulerDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SchedulerDbContext>()
            .UseNpgsql("Host=localhost;Database=design")
            .UseSnakeCaseNamingConvention()
            .Options);
}

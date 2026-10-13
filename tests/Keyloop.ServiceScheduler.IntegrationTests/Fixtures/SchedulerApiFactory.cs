using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using Respawn;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>
/// The real API host on the shared Testcontainers database, in the <c>SystemTest</c> environment, with migrations applied at
/// startup, no seeding, and the clock replaced by <paramref name="clock"/>. When <paramref name="logs"/> is given it receives every
/// log entry the host writes, from startup on (the logging configuration's level filters still apply).
/// <paramref name="hostStartDelay"/> widens the build-to-start window for startup-race regression tests.
/// </summary>
public sealed class SchedulerApiFactory(string connectionString, FakeTimeProvider clock, CapturingLoggerProvider? logs = null,
    TimeSpan? hostStartDelay = null)
    : WebApplicationFactory<Program>
{
    private Respawner? _respawner;

    public FakeTimeProvider Clock { get; } = clock;

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = builder.Build();
        var gate = host.Services.GetRequiredService<StartupGate>();
        if (hostStartDelay is { } delay)
        {
            // Test-only scheduling hook: simulate a slow factory after HostBuilt, before its startup callback is registered.
            Thread.Sleep(delay);
        }

        Task started;
        try
        {
            // DeferredHost.StartAsync resolves IHostApplicationLifetime and registers ApplicationStarted before its first await.
            // Only then may Program.cs validate, fail and dispose the provider. Awaiting the task propagates the entry point error.
            started = host.StartAsync();
        }
        finally
        {
            gate.Release();
        }
        started.GetAwaiter().GetResult();
        return host;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("SystemTest");
        builder.UseSetting("Auth:TeamDomain", "https://fixture.cloudflareaccess.com");
        builder.UseSetting("Auth:Audience:0", "local-fixture-audience");
        builder.UseSetting("ConnectionStrings:schedulerdb", connectionString);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Database:SeedDemoData", "false");
        builder.ConfigureTestServices(services =>
        {
            // The app validates immediately after Build and disposes on failure. WebApplicationFactory's deferred host has
            // already escaped via HostBuilt at that point, but may still need the provider to register its startup callback.
            // A gate per provider also covers WithWebHostBuilder children without sharing startup state between hosts.
            services.AddSingleton(_ => new StartupGate());
            var validator = services.Single(service => service.ServiceType == typeof(IStartupValidator));
            services.Replace(ServiceDescriptor.Describe(typeof(IStartupValidator), sp => new GatedStartupValidator(
                sp.GetRequiredService<StartupGate>(), () => (IStartupValidator)(validator.ImplementationInstance
                    ?? validator.ImplementationFactory?.Invoke(sp)
                    ?? ActivatorUtilities.CreateInstance(sp, validator.ImplementationType!))), validator.Lifetime));
            services.AddSingleton<TimeProvider>(Clock);
            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthenticationHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthenticationHandler.SchemeName;
                options.DefaultForbidScheme = TestAuthenticationHandler.SchemeName;
            }).AddScheme<AuthenticationSchemeOptions, TestAuthenticationHandler>(TestAuthenticationHandler.SchemeName, _ => { });
            if (logs is not null)
            {
                services.AddSingleton<ILoggerProvider>(logs);
            }
        });
    }

    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        // Existing engine tests exercise authorized booking and detail reads. Authentication tests explicitly select each caller.
        client.DefaultRequestHeaders.Add(TestAuthenticationHandler.Header, "Admin");
    }

    /// <summary>Starts the host (which applies migrations) and deletes every row in <c>public</c> except the migration history.</summary>
    public async Task ResetAsync()
    {
        _ = Services;
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        _respawner ??= await Respawner.CreateAsync(connection, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = ["__EFMigrationsHistory"],
        });
        await _respawner.ResetAsync(connection);
    }

    /// <summary>Runs <paramref name="work"/> against a fresh DI scope's <see cref="SchedulerDbContext"/> (with the real interceptors).</summary>
    public async Task<T> WithDbAsync<T>(Func<SchedulerDbContext, Task<T>> work)
    {
        ArgumentNullException.ThrowIfNull(work);
        await using var scope = Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }

    /// <inheritdoc cref="WithDbAsync{T}(Func{SchedulerDbContext, Task{T}})"/>
    public async Task WithDbAsync(Func<SchedulerDbContext, Task> work)
    {
        ArgumentNullException.ThrowIfNull(work);
        await using var scope = Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<SchedulerDbContext>());
    }

    private sealed class StartupGate
    {
        private readonly TaskCompletionSource _factoryStarting = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Release() => _factoryStarting.TrySetResult();

        public void Wait() => _factoryStarting.Task.WaitAsync(TimeSpan.FromSeconds(30)).GetAwaiter().GetResult();
    }

    private sealed class GatedStartupValidator(StartupGate gate, Func<IStartupValidator> validator) : IStartupValidator
    {
        private readonly Lazy<IStartupValidator> _validator = new(validator);

        public void Validate()
        {
            gate.Wait();
            _validator.Value.Validate();
        }
    }
}

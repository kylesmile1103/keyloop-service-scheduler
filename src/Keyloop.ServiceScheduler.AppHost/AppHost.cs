// Aspire application host for local development and Docker Compose publishing.
using Aspire.Hosting.Docker.Resources;
using Aspire.Hosting.Docker.Resources.ServiceNodes;
using Microsoft.Extensions.Configuration;

const string PostgresUserName = "scheduler";

var builder = DistributedApplication.CreateBuilder(args);

builder.AddDockerComposeEnvironment("compose")
    .ConfigureComposeFile(compose =>
    {
        // Dedicated subnet trusted by appsettings.Demo.json; keeps the API unpublished (expose only).
        compose.Networks["aspire"].Ipam = new Ipam { Config = [new Dictionary<string, string> { ["subnet"] = "172.30.14.0/24" }] };

        // Interpolate default user name in Compose since aspire publish writes empty deployment inputs to .env.
        ComposeInputs.DefaultTo(compose, "POSTGRES_USER", PostgresUserName);
    })
    .ConfigureEnvFile(inputs => inputs["POSTGRES_USER"].Description = $"Parameter postgres-user (empty means {PostgresUserName})");

// Generate and persist the database password in user secrets on first run.
var pgUser = builder.AddParameter("postgres-user", PostgresUserName, publishValueAsDefault: true);
var pgPassword = builder.AddParameter("postgres-password", new GenerateParameterDefault { MinLength = 24, Special = false }, secret: true, persist: true);

// Pin PostgreSQL 17 before attaching the data volume so WithDataVolume selects the pre-18 data directory path.
var persistentResources = builder.Configuration.GetValue("AppHost:UsePersistentResources", true);
var postgres = builder.AddPostgres("postgres", pgUser, pgPassword)
    .WithImageTag("17");
if (persistentResources)
{
    postgres.WithDataVolume("keyloop-scheduler-pgdata").WithLifetime(ContainerLifetime.Persistent);
}
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithPgWeb(pgweb => pgweb.WithLifetime(persistentResources ? ContainerLifetime.Persistent : ContainerLifetime.Session));
}

var db = postgres.AddDatabase("schedulerdb");
if (builder.ExecutionContext.IsPublishMode)
{
    // Compose does not execute AddDatabase's run-mode callback; PostgreSQL's entrypoint initializes the database.
    postgres.WithEnvironment("POSTGRES_DB", "schedulerdb");
}

var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .DisableForwardedHeaders() // the API owns the fail-closed trust policy, including when forwarding is disabled
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health", endpointName: "http") // readiness does not depend on trusting a local development certificate
    .PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");

// Run-mode identity is a local convenience and needs no Access settings or generated secrets.
if (builder.ExecutionContext.IsRunMode)
{
    api.WithEnvironment("Auth__Mode", "Development")
        .WithEnvironment("Auth__Development__Email", builder.Configuration["Parameters:auth-development-email"] ?? "admin@keyloop.test");
    var roles = (builder.Configuration["Parameters:auth-development-roles"] ?? "Admin").Split(',', StringSplitOptions.TrimEntries);
    for (var i = 0; i < roles.Length; i++)
    {
        api.WithEnvironment($"Auth__Development__Roles__{i}", roles[i]);
    }
}
else
{
    api.WithEnvironment("Auth__Mode", "CloudflareAccess")
        .WithEnvironment("Auth__TeamDomain", builder.AddParameter("access-team-domain"))
        .WithEnvironment("Auth__Audience__0", builder.AddParameter("access-audience"));
}

// Optional developer-owned secrets for Cloudflare AI Gateway triage.
if (builder.ExecutionContext.IsRunMode &&
    !string.IsNullOrWhiteSpace(builder.Configuration["Parameters:cloudflare-account-id"]) &&
    !string.IsNullOrWhiteSpace(builder.Configuration["Parameters:cloudflare-ai-token"]))
{
    var account = builder.AddParameter("cloudflare-account-id");
    var token = builder.AddParameter("cloudflare-ai-token", secret: true);
    api.WithEnvironment("Triage__Enabled", "true")
        .WithEnvironment("Triage__AccountId", account)
        .WithEnvironment("Triage__GatewayId", "keyloop-scheduler")
        .WithEnvironment("Triage__ApiToken", token);
}

// Label available API endpoints and attach the Scalar API reference link.
string[] apiEndpoints = [.. new[] { "https", "http" }.Where(name => api.GetEndpoint(name).Exists)];
foreach (var name in apiEndpoints)
{
    api.WithUrlForEndpoint(name, url => url.DisplayText = $"API ({name})");
}

if (apiEndpoints is [var scalarEndpoint, ..])
{
    // Build from the endpoint URL so it preserves the configured dev.localhost host.
    api.WithUrls(context =>
    {
        if (context.Urls.FirstOrDefault(url => url.Endpoint?.EndpointName == scalarEndpoint) is { } endpointUrl)
        {
            context.Urls.Add(new ResourceUrlAnnotation
            {
                Url = new Uri(new Uri(endpointUrl.Url), "/scalar/v1").ToString(),
                DisplayText = "Scalar API reference",
                Endpoint = endpointUrl.Endpoint,
            });
        }
    });
}

// Local Mailpit capture inbox for run mode.
if (builder.ExecutionContext.IsRunMode)
{
    var mailpit = builder.AddMailPit("mailpit")
        .WithImageTag("v1.31.5")
        .WithLifetime(ContainerLifetime.Session)
        .WithUrlForEndpoint("http", url => url.DisplayText = "Mailpit inbox");
    api.WithEnvironment("Notifications__Enabled", "true")
        .WithEnvironment("Notifications__Provider", "Smtp")
        .WithEnvironment("Notifications__Smtp__Host", mailpit.Resource.Host)
        .WithEnvironment("Notifications__Smtp__Port", mailpit.Resource.Port)
        .WithEnvironment("Notifications__Smtp__Encryption", "None")
        .WithReference(mailpit)
        .WaitFor(mailpit);
}

// Dashboard command to reseed demo data in run mode, authenticated via a per-run secret header.
if (builder.ExecutionContext.IsRunMode)
{
    var reseedKey = builder.AddParameter("demo-reseed-key", new GenerateParameterDefault { MinLength = 32, Special = false }, secret: true);
    api.WithEnvironment("Demo__ReseedKey", reseedKey)
        .WithHttpCommand(
            "/api/v1/admin/demo/reseed",
            "Reseed demo data",
            endpointName: "http",
            commandName: "reseed-demo-data",
            commandOptions: new HttpCommandOptions
            {
                Method = HttpMethod.Post,
                Description = "Deletes all appointments of the demo dealerships and re-creates the deterministic demo week.",
                ConfirmationMessage = "Delete all appointments and reseed the demo week?",
                IconName = "DatabaseArrowRight",
                IsHighlighted = true,
                ResultMode = HttpCommandResultMode.Json,
                PrepareRequest = async context =>
                    context.Request.Headers.Add("X-Reseed-Key", await reseedKey.Resource.GetValueAsync(context.CancellationToken)),
            });
}
else
{
    api.WithEnvironment("ASPNETCORE_ENVIRONMENT", "Demo")
        .WithEnvironment("DOTNET_ENVIRONMENT", "Demo")
        .PublishAsDockerFile(container => container.WithDockerfile("../../", "src/Keyloop.ServiceScheduler.Api/Dockerfile"));
}

var web = builder.AddViteApp("web", "../Keyloop.ServiceScheduler.Web")
    .WithPnpm(installArgs: ["--frozen-lockfile"])
    .WaitFor(api)
    .WithHttpHealthCheck("/")
    .WithExternalHttpEndpoints();

if (builder.ExecutionContext.IsRunMode)
{
    web.WithReference(api)
        .WithOtlpExporter(OtlpProtocol.HttpProtobuf); // dashboard credentials reach the browser only from the dev server
}
else
{
    // Configure nginx upstream and target port for published container builds.
    web.WithEnvironment("API_UPSTREAM", api.GetEndpoint("http"))
        .PublishAsDockerFile(container => container
            .WithEndpoint("http", endpoint => endpoint.TargetPort = 8080));
}

builder.Build().Run();

/// <summary>Defaults for Compose deployment inputs, which <c>aspire publish</c> leaves empty in the generated <c>.env</c>.</summary>
internal static class ComposeInputs
{
    /// <summary>
    /// Rewrites <c>${name}</c> references in service environments to <c>${name:-value}</c> so unset inputs fall back to <paramref name="value"/>.
    /// </summary>
    public static void DefaultTo(ComposeFile compose, string name, string value)
    {
        var reference = $"${{{name}}}";
        var withDefault = $"${{{name}:-{value}}}";
        var rewritten = 0;
        foreach (var environment in compose.Services.Values.Select(service => service.Environment))
        {
            foreach (var (key, text) in environment.Where(entry => entry.Value.Contains(reference, StringComparison.Ordinal)).ToList())
            {
                environment[key] = text.Replace(reference, withDefault, StringComparison.Ordinal);
                rewritten++;
            }
        }

        if (rewritten == 0 || compose.ToYaml().Contains(reference, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"The generated Compose file references {reference} {(rewritten == 0 ? "nowhere" : "outside a service environment")}; "
                + "update ComposeInputs.DefaultTo in AppHost.cs.");
        }
    }
}

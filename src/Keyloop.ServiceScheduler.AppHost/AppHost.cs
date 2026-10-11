// The development platform (SYSTEM_DESIGN §8.6, ADR-019, Addendum C): `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` (or
// `aspire run`) generates and keeps the secrets, starts PostgreSQL with a persistent volume and pgweb, the API (which migrates and seeds
// in Development) behind its health check, and, once it exists, the dispatch board; `aspire publish` turns the same model into Docker
// Compose.
using Aspire.Hosting.Docker.Resources;
using Aspire.Hosting.Docker.Resources.ServiceNodes;
using Microsoft.Extensions.Configuration;

const string PostgresUserName = "scheduler";

var builder = DistributedApplication.CreateBuilder(args);

// The publish target (Addendum C §C6, Task 18). In run mode it is not part of the model.
builder.AddDockerComposeEnvironment("compose")
    .ConfigureComposeFile(compose =>
    {
        // This dedicated subnet is the only network appsettings.Demo.json trusts; AppHostModelTests fails when the two differ. It contains
        // the bridge gateway, from which Docker delivers traffic for published host ports, so the API stays unpublished (expose only).
        compose.Networks["aspire"].Ipam = new Ipam { Config = [new Dictionary<string, string> { ["subnet"] = "172.30.14.0/24" }] };

        // `aspire publish` writes every deployment input to .env with an empty value and ignores parameter defaults there, so the user
        // name's default travels in the Compose interpolation instead: an unset or empty POSTGRES_USER resolves to the run-mode user.
        ComposeInputs.DefaultTo(compose, "POSTGRES_USER", PostgresUserName);
    })
    .ConfigureEnvFile(inputs => inputs["POSTGRES_USER"].Description = $"Parameter postgres-user (empty means {PostgresUserName})");

// Secrets (§C1): the password is generated on the first run and kept in this project's user secrets (Parameters:postgres-password),
// so the persistent container's credentials stay valid across runs and nobody types a secret. In publish mode both parameters become
// deployment inputs; the user name keeps its default through the Compose file above, the password has none.
var pgUser = builder.AddParameter("postgres-user", PostgresUserName, publishValueAsDefault: true);
var pgPassword = builder.AddParameter("postgres-password", new GenerateParameterDefault { MinLength = 24, Special = false }, secret: true, persist: true);

// PostgreSQL 17, the version the integration tests run against (Testcontainers postgres:17). The tag is set before the data volume
// because WithDataVolume picks the data directory from it (/var/lib/postgresql/data up to 17). The container and its volume outlive
// the AppHost, so a restart keeps the data. Isolated verification can opt out without changing the developer's volume or secrets.
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
    // Compose does not execute AddDatabase's run-mode creation callback. PostgreSQL's entrypoint handles an empty data directory.
    postgres.WithEnvironment("POSTGRES_DB", "schedulerdb");
}

// The API receives its connection string only as ConnectionStrings__schedulerdb (WithReference), starts once the database is
// healthy, and is healthy itself when /health (which includes the database check) answers 200.
var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .DisableForwardedHeaders() // the API owns the fail-closed trust policy, including when forwarding is disabled
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health", endpointName: "http") // readiness does not depend on trusting a local development certificate
    .PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");

// The dashboard labels the API's endpoints and links to Scalar. The AppHost's launch profile picks the API's (DOTNET_LAUNCH_PROFILE):
// `https` gives it an https and an http endpoint, `http` only the latter. A URL callback on an endpoint the API lacks is dropped (with a
// warning), so only the endpoints it has are labelled, and the Scalar link goes on https when there is one, else on http.
string[] apiEndpoints = [.. new[] { "https", "http" }.Where(name => api.GetEndpoint(name).Exists)];
foreach (var name in apiEndpoints)
{
    api.WithUrlForEndpoint(name, url => url.DisplayText = $"API ({name})");
}

if (apiEndpoints is [var scalarEndpoint, ..])
{
    api.WithUrlForEndpoint(scalarEndpoint, _ => new ResourceUrlAnnotation { Url = "/scalar/v1", DisplayText = "Scalar API reference" });
}

// Mailpit is a local capture inbox only. Publish mode retains Provider=None until the production adapter is available.
// CommunityToolkit 13.6.0 targets Aspire 13.6 and is compatible with the pinned hosting packages 13.6.1.
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

// The dashboard's "Reseed demo data" command (§C3), in run mode only. Its key is a fresh secret for every run (the API is restarted
// with the AppHost, so nothing needs to remember it), given to the API as Demo__ReseedKey and sent by the command as X-Reseed-Key;
// without it the API answers the route like an unknown one. The command uses the plain-HTTP endpoint, like the Vite proxy (§C5), so
// it works whether or not the development certificate is trusted.
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

// The dispatch board (§C5). The frontend lane removes this guard when it lands src/Keyloop.ServiceScheduler.Web (Task 15).
if (Directory.Exists(Path.Combine(builder.AppHostDirectory, "../Keyloop.ServiceScheduler.Web")))
{
    builder.AddViteApp("web", "../Keyloop.ServiceScheduler.Web")
        .WithPnpm()                                   // an installer child resource runs `pnpm install` before the dev server starts
        .WithReference(api)                           // API_HTTP / API_HTTPS (and services__api__*): the Vite proxy's target
        .WaitFor(api)
        .WithOtlpExporter(OtlpProtocol.HttpProtobuf)  // browsers export over HTTP; vite.config.ts exposes it in development only
        .WithHttpHealthCheck("/")
        .WithExternalHttpEndpoints()
        .PublishAsDockerFile();                       // the app's own Dockerfile (nginx); AddViteApp already prefers it in 13.6.1
}

builder.Build().Run();

/// <summary>Defaults for Compose deployment inputs, which <c>aspire publish</c> leaves empty in the generated <c>.env</c>.</summary>
internal static class ComposeInputs
{
    /// <summary>
    /// Rewrites every <c>${name}</c> in the services' environments to <c>${name:-value}</c>, so Compose substitutes
    /// <paramref name="value"/> when the input is unset or empty. Fails the publish if the generated file references the input
    /// nowhere, or anywhere else, rather than writing a bundle that would start with an empty value.
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

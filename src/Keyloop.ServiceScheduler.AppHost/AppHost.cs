// The development platform (SYSTEM_DESIGN §8.6, ADR-019, Addendum C): `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` (or
// `aspire run`) generates and keeps the secrets, starts PostgreSQL with a persistent volume and pgweb, the API (which migrates and seeds
// in Development) behind its health check, and, once it exists, the dispatch board; `aspire publish` turns the same model into Docker
// Compose.
var builder = DistributedApplication.CreateBuilder(args);

// The publish target (Addendum C §C6, Task 18). In run mode it is not part of the model.
builder.AddDockerComposeEnvironment("compose");

// Secrets (§C1): the password is generated on the first run and kept in this project's user secrets (Parameters:postgres-password),
// so the persistent container's credentials stay valid across runs and nobody types a secret. In publish mode both parameters become
// deployment inputs; the user name carries its default there, the password does not.
var pgUser = builder.AddParameter("postgres-user", "scheduler", publishValueAsDefault: true);
var pgPassword = builder.AddParameter("postgres-password", new GenerateParameterDefault { MinLength = 24, Special = false }, secret: true, persist: true);

// PostgreSQL 17, the version the integration tests run against (Testcontainers postgres:17). The tag is set before the data volume
// because WithDataVolume picks the data directory from it (/var/lib/postgresql/data up to 17). The container and its volume outlive
// the AppHost, so a restart keeps the data and skips the database start-up; `docker volume rm keyloop-scheduler-pgdata` starts over.
var postgres = builder.AddPostgres("postgres", pgUser, pgPassword)
    .WithImageTag("17")
    .WithDataVolume("keyloop-scheduler-pgdata")
    .WithLifetime(ContainerLifetime.Persistent);
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithPgWeb(pgweb => pgweb.WithLifetime(ContainerLifetime.Persistent));
}

var db = postgres.AddDatabase("schedulerdb");

// The API receives its connection string only as ConnectionStrings__schedulerdb (WithReference), starts once the database is
// healthy, and is healthy itself when /health (which includes the database check) answers 200.
var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health")
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

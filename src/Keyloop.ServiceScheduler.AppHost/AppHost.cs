// The local development platform (SYSTEM_DESIGN §8.6, ADR-019): `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` starts
// PostgreSQL, the API (which migrates and seeds in Development) and, once it exists, the dispatch board, with the Aspire dashboard.
var builder = DistributedApplication.CreateBuilder(args);

// PostgreSQL 17, the version the integration tests run against (Testcontainers postgres:17).
var postgres = builder.AddPostgres("postgres")
    .WithImageTag("17");
var db = postgres.AddDatabase("schedulerdb");

// The API receives its connection string only as ConnectionStrings__schedulerdb (WithReference), starts once the database is
// healthy, and is healthy itself when /health (which includes the database check) answers 200. The dashboard links to Scalar.
var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health")
    .WithUrlForEndpoint("https", _ => new ResourceUrlAnnotation { Url = "/scalar/v1", DisplayText = "Scalar API reference" });

// The dispatch board (Task 15) is added once its project exists.
if (Directory.Exists(Path.Combine(builder.AppHostDirectory, "../Keyloop.ServiceScheduler.Web")))
{
    builder.AddViteApp("web", "../Keyloop.ServiceScheduler.Web")
        .WithPnpm()
        .WithReference(api)
        .WaitFor(api)
        .WithExternalHttpEndpoints();
}

builder.Build().Run();

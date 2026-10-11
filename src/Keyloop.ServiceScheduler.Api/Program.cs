using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi("v1");

builder.Services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.SectionName);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<DomainEventInterceptor>();
builder.Services.AddScoped<DayScheduleReader>();

// The connection string is read when a context is first configured, not here, so WebApplicationFactory overrides apply and
// build-time OpenAPI generation can start the host without a database.
builder.Services.AddDbContext<SchedulerDbContext>((sp, options) => options
    .UseNpgsql(sp.GetRequiredService<IConfiguration>().GetConnectionString("schedulerdb")
        ?? throw new InvalidOperationException("Connection string 'schedulerdb' is missing."))
    .UseSnakeCaseNamingConvention()
    .AddInterceptors(sp.GetRequiredService<DomainEventInterceptor>()));
builder.EnrichNpgsqlDbContext<SchedulerDbContext>();

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.MapDefaultEndpoints();
if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}
app.MapGet("/api/v1/ping", () => TypedResults.Ok(new { status = "ok" })).WithName("Ping");

await DatabaseInitializer.InitializeAsync(app.Services, CancellationToken.None);
await app.RunAsync();

public partial class Program;

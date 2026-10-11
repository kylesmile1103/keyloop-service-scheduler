using System.Text.Json.Serialization;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();

// Options are bound by the configuration-binding generator and validated at startup by [OptionsValidator] validators (Addendum A §A4).
builder.Services.AddOptions<SchedulingOptions>().BindConfiguration(SchedulingOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<SchedulingOptions>, SchedulingOptionsValidator>();
builder.Services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.SectionName).ValidateOnStart(); // nothing to validate beyond binding
builder.Services.AddOptions<SecurityOptions>().BindConfiguration(SecurityOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<SecurityOptions>, SecurityOptionsValidator>();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp =>
{
    var scheduling = sp.GetRequiredService<IOptions<SchedulingOptions>>().Value;
    return new BookingWindowPolicy(sp.GetRequiredService<TimeProvider>(), scheduling.MinimumLeadTime, TimeSpan.FromDays(scheduling.BookingHorizonDays));
});
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<DomainEventInterceptor>();
builder.Services.AddScoped<IDomainEventObserver, TelemetryDomainEventObserver>();
builder.Services.AddScoped<DayScheduleReader>();

// The connection string is read when a context is first configured, not here, so WebApplicationFactory overrides apply. During
// build-time OpenAPI generation there is no database: a placeholder that is never opened stands in (Addendum B §B1).
builder.Services.AddDbContext<SchedulerDbContext>((sp, options) => options
    .UseNpgsql(BuildTimeOpenApi.IsActive
        ? BuildTimeOpenApi.PlaceholderConnectionString
        : sp.GetRequiredService<IConfiguration>().GetConnectionString("schedulerdb")
            ?? throw new InvalidOperationException("Connection string 'schedulerdb' is missing."))
    .UseSnakeCaseNamingConvention()
    .AddInterceptors(sp.GetRequiredService<DomainEventInterceptor>()));
builder.EnrichNpgsqlDbContext<SchedulerDbContext>();

// Handlers and validators are registered explicitly, one line each (ADR-016, Addendum A §A3); the slices add theirs (Tasks 8–12).
builder.Services.AddScoped<GetDealershipsHandler>();
builder.Services.AddScoped<GetServiceTypesHandler>();
builder.Services.AddScoped<GetAvailabilityHandler>();
builder.Services.AddScoped<IValidator<GetAvailabilityQuery>, GetAvailabilityValidator>();
builder.Services.AddScoped<BookAppointmentHandler>();
builder.Services.AddScoped<IValidator<BookAppointmentRequest>, BookAppointmentValidator>();

// The framework adds traceId to every problem; instance is the request path unless the writer set one.
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx => ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path);

// Ours first in the resolver chain (Addendum A §A2). AddProblemDetails and AddOpenApi each insert their own context at index 0
// when the options are configured, so this runs as a post-configuration, after all of them; their contexts stay in the chain.
// Enums are strings via the context's UseStringEnumConverter, not the reflection-based JsonStringEnumConverter. Numbers are strict:
// the web defaults also read them from strings, which the OpenAPI document then types as "integer or string".
builder.Services.PostConfigure<JsonOptions>(o =>
{
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, SchedulerJsonContext.Default);
    o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
});
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

// Binding failures the framework rejects throw in every environment (not only Development), so GlobalExceptionHandler answers them
// the same way. (A nullable parameter that fails to parse on a filtered endpoint binds as null and reaches the validator instead.)
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

builder.Services.AddSchedulerOpenApi();
builder.Services.AddCors();
builder.Services.AddOptions<CorsOptions>().Configure<IOptions<SecurityOptions>>((cors, security) => cors.AddDefaultPolicy(policy =>
{
    // Default-deny: no origins configured means no CORS headers at all.
    if (security.Value.AllowedOrigins is { Length: > 0 } origins)
    {
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Location", "Idempotent-Replayed");
    }
}));
builder.Services.AddSchedulerRateLimiting();
builder.Services.AddSchedulerForwardedHeaders();
builder.Services.AddSingleton<SecurityHeadersMiddleware>();
builder.Services.AddScoped<CurrentActorMiddleware>();
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024);

var app = builder.Build();

// Validate every ValidateOnStart options type now: the host would do it only in StartAsync, after the database initialiser below
// has already migrated or seeded on a misconfigured instance. Whatever fails here (validation, or a value the binder cannot
// convert) is logged at Critical (events 1103/1104) and the app is disposed before rethrowing, which flushes the console and OTLP
// log exporters: the crash leaves a structured record.
try
{
    app.Services.GetRequiredService<IStartupValidator>().Validate();
}
catch (Exception ex)
{
    StartupFailureLog.Write(app.Logger, ex);
    await app.DisposeAsync();
    throw;
}

var apiReference = !app.Environment.IsProduction();
var database = app.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value;
var security = app.Services.GetRequiredService<IOptions<SecurityOptions>>().Value;
app.Logger.ApiStarting(app.Environment.EnvironmentName, database.MigrateOnStartup, database.SeedDemoData, apiReference ? "on" : "off", "anonymous (authentication is deferred)");

// First, so that everything after it sees the client's address and scheme rather than the ingress's.
if (security.ForwardedHeaders.Enabled)
{
    app.UseForwardedHeaders();
}

app.UseExceptionHandler();
app.UseStatusCodePages();

// Demo (the Aspire-published compose bundle) serves plain HTTP, so it has no HSTS either (SYSTEM_DESIGN §10).
if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("SystemTest") && !app.Environment.IsEnvironment("Demo"))
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseCors();
app.UseRateLimiter();
app.UseMiddleware<CurrentActorMiddleware>();

app.MapDefaultEndpoints();
if (apiReference)
{
    app.MapOpenApi();
    app.MapScalarApiReference(options => options
        .WithTitle("Keyloop Service Scheduler API")
        .WithDefaultHttpClient(ScalarTarget.Shell, ScalarClient.Curl)
        .ShowOperationId()
        .ExpandAllTags());
}

app.MapSchedulerEndpoints();

if (!BuildTimeOpenApi.IsActive)
{
    await DatabaseInitializer.InitializeAsync(app.Services, CancellationToken.None);
}

await app.RunAsync();

public partial class Program;

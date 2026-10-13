using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Api.Features.Admin.History;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Health;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.GetAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Api.Features.Triage;
using Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Api.Features.Triage.UploadBookingTriageImage;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;

// Build-time OpenAPI generation runs in a fixed environment; otherwise standard configuration sources apply.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    EnvironmentName = BuildTimeOpenApi.IsActive ? BuildTimeOpenApi.EnvironmentName : null,
});
builder.AddServiceDefaults();

builder.Services.AddOptions<SchedulingOptions>().BindConfiguration(SchedulingOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<SchedulingOptions>, SchedulingOptionsValidator>();
builder.Services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.SectionName).ValidateOnStart();
builder.Services.AddOptions<SecurityOptions>().BindConfiguration(SecurityOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<SecurityOptions>, SecurityOptionsValidator>();
builder.Services.AddOptions<DemoOptions>().BindConfiguration(DemoOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<DemoOptions>, DemoOptionsValidator>();

builder.Services.AddOptions<TriageConnectionOptions>().BindConfiguration(TriageConnectionOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<TriageConnectionOptions>, TriageConnectionOptionsValidator>();
builder.Services.AddOptions<TriageOptions>().BindConfiguration(TriageConnectionOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<TriageOptions>, TriageOptionsValidator>();
#pragma warning disable EXTEXP0001
builder.Services.AddHttpClient<CloudflareTriageClient>(client =>
{
    client.Timeout = Timeout.InfiniteTimeSpan; // the adapter enforces its own deadline across retry and response parsing
    client.MaxResponseContentBufferSize = 64 * 1024;
}).RemoveAllResilienceHandlers().RemoveAllLoggers(); // avoid retaining upstream response text in transport logs
builder.Services.AddSingleton<TransientTriageImages>();
builder.Services.AddHttpClient<TriageImageStore>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
    client.MaxResponseContentBufferSize = TriageImageLimits.MaxImageBytes;
}).RemoveAllResilienceHandlers().RemoveAllLoggers();
#pragma warning restore EXTEXP0001

builder.Services.AddOptions<NotificationOptions>().BindConfiguration(NotificationOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<NotificationOptions>, NotificationOptionsValidator>();
builder.Services.AddSingleton<IEmailSender>(sp => sp.GetRequiredService<IOptions<NotificationOptions>>().Value.Provider switch
{
    NotificationProvider.Smtp => new SmtpEmailSender(sp.GetRequiredService<IOptions<NotificationOptions>>(), sp.GetRequiredService<TimeProvider>()),
    NotificationProvider.None => new DisabledEmailSender(),
    _ => throw new InvalidOperationException("Notifications:Provider=Cloudflare is reserved; the Cloudflare email adapter is not implemented yet. Select Smtp or None."),
});
builder.Services.AddSingleton<NotificationSignal>();
builder.Services.AddHostedService<NotificationDispatcher>();
builder.Services.AddSingleton<NotificationBacklogMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<NotificationBacklogMonitor>());

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSchedulerAuthentication(builder.Environment);
builder.Services.AddSingleton(sp =>
{
    var scheduling = sp.GetRequiredService<IOptions<SchedulingOptions>>().Value;
    return new BookingWindowPolicy(sp.GetRequiredService<TimeProvider>(), scheduling.MinimumLeadTime, TimeSpan.FromDays(scheduling.BookingHorizonDays));
});
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<DomainEventInterceptor>();
builder.Services.AddScoped<IDomainEventObserver, TelemetryDomainEventObserver>();
builder.Services.AddScoped<IDomainEventObserver, NotificationNudgeObserver>();
builder.Services.AddScoped<DayScheduleReader>();
builder.Services.AddScoped<ServiceCatalogueReader>();

// Resolve the connection string lazily so test overrides apply, using a placeholder during build-time OpenAPI generation.
builder.Services.AddDbContext<SchedulerDbContext>((sp, options) => options
    .UseNpgsql(BuildTimeOpenApi.IsActive
        ? BuildTimeOpenApi.PlaceholderConnectionString
        : sp.GetRequiredService<IConfiguration>().GetConnectionString("schedulerdb")
            ?? throw new InvalidOperationException("Connection string 'schedulerdb' is missing."))
    .UseSnakeCaseNamingConvention()
    // Expected constraint violations (23P01, 23505) are handled in domain/application flow; log EF Core command failures at Information.
    .ConfigureWarnings(w => w.Log((CoreEventId.SaveChangesFailed, LogLevel.Information), (RelationalEventId.CommandError, LogLevel.Information)))
    .AddInterceptors(sp.GetRequiredService<DomainEventInterceptor>()));
builder.EnrichNpgsqlDbContext<SchedulerDbContext>();
builder.Services.AddHealthChecks().AddCheck<SchedulerReadinessCheck>("scheduler_schema", tags: ["ready"]);

builder.Services.AddScoped<AdminResourcesHandler>();
builder.Services.AddScoped<AdminPolicyHandler>();
builder.Services.AddScoped<AdminHistoryHandler>();
builder.Services.AddScoped<IValidator<TechnicianWriteRequest>, TechnicianWriteValidator>();
builder.Services.AddScoped<IValidator<BayWriteRequest>, BayWriteValidator>();
builder.Services.AddScoped<IValidator<PolicyWriteRequest>, PolicyWriteValidator>();
builder.Services.AddScoped<GetDealershipsHandler>();
builder.Services.AddScoped<GetFeaturesHandler>();
builder.Services.AddScoped<GetServiceTypesHandler>();
builder.Services.AddScoped<GetAvailabilityHandler>();
builder.Services.AddScoped<IValidator<GetAvailabilityQuery>, GetAvailabilityValidator>();
builder.Services.AddScoped<BookAppointmentHandler>();
builder.Services.AddScoped<RequirementPolicyReader>();
builder.Services.AddScoped<FindReturningCustomersHandler>();
builder.Services.AddScoped<IValidator<FindReturningCustomersRequest>, FindReturningCustomersValidator>();
builder.Services.AddScoped<ResolveVehicleProfileHandler>();
builder.Services.AddScoped<IValidator<ResolveVehicleProfileRequest>, ResolveVehicleProfileValidator>();
builder.Services.AddScoped<IValidator<BookAppointmentRequest>, BookAppointmentValidator>();
builder.Services.AddScoped<GetAppointmentHandler>();
builder.Services.AddScoped<ListAppointmentsHandler>();
builder.Services.AddScoped<IValidator<ListAppointmentsQuery>, ListAppointmentsValidator>();
builder.Services.AddScoped<CancelAppointmentHandler>();
builder.Services.AddScoped<IValidator<CancelAppointmentRequest>, CancelAppointmentValidator>();
builder.Services.AddScoped<GetWorkshopScheduleHandler>();
builder.Services.AddScoped<IValidator<GetWorkshopScheduleQuery>, GetWorkshopScheduleValidator>();
builder.Services.AddScoped<ReseedDemoDataHandler>();
builder.Services.AddScoped<GetBookingTriageStatusHandler>();
builder.Services.AddScoped<TriageBookingHandler>();
builder.Services.AddScoped<IValidator<TriageBookingRequest>, TriageBookingValidator>();
builder.Services.AddScoped<UploadBookingTriageImageHandler>();
builder.Services.AddScoped<IValidator<UploadBookingTriageImageRequest>, UploadBookingTriageImageValidator>();

builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx => ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path);

// Prepend SchedulerJsonContext after AddProblemDetails/AddOpenApi and enforce strict number parsing.
builder.Services.PostConfigure<JsonOptions>(o =>
{
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, SchedulerJsonContext.Default);
    o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
});
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

builder.Services.AddSchedulerOpenApi();
builder.Services.AddCors();
builder.Services.AddOptions<CorsOptions>().Configure<IOptions<SecurityOptions>>((cors, security) => cors.AddDefaultPolicy(policy =>
{
    if (security.Value.AllowedOrigins is { Length: > 0 } origins)
    {
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Location", "Idempotent-Replayed", RequestCorrelationMiddleware.HeaderName);
    }
}));
builder.Services.AddSchedulerRateLimiting();
builder.Services.AddSchedulerForwardedHeaders();
builder.Services.AddOptions<Microsoft.AspNetCore.HttpsPolicy.HttpsRedirectionOptions>()
    .Configure<IOptions<SecurityOptions>>((options, security) => options.HttpsPort = security.Value.HttpsRedirection.HttpsPort);
builder.Services.AddSingleton<SecurityHeadersMiddleware>();
builder.Services.AddSingleton<RequestCorrelationMiddleware>();
builder.Services.AddScoped<CurrentActorMiddleware>();
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024);

var app = builder.Build();

// Validate startup options before running database migrations or seeding, and flush telemetry before terminating on failure.
try
{
    app.Services.GetRequiredService<IStartupValidator>().Validate();
    if (!BuildTimeOpenApi.IsActive)
    {
        // Validate the connection string up front without echoing secrets in exception messages.
        SchedulerConnectionString.Validate(app.Configuration.GetConnectionString(SchedulerConnectionString.Name));
    }

    // Pin the scheduling snapshot at startup so configuration changes require a restart.
    _ = app.Services.GetRequiredService<IOptions<SchedulingOptions>>().Value;
    var triage = app.Services.GetRequiredService<IOptions<TriageConnectionOptions>>().Value;
    if (app.Environment.IsProduction() && triage.Enabled && triage.ImagesEnabled && triage.ImageStoreUrl.Length == 0)
    {
        throw new InvalidOperationException("Production image triage requires the private R2 relay at Triage:ImageStoreUrl.");
    }

    if (app.Services.GetRequiredService<IOptions<NotificationOptions>>().Value.Provider == NotificationProvider.Cloudflare)
    {
        throw new InvalidOperationException("Notifications:Provider=Cloudflare is reserved; the Cloudflare email adapter is not implemented yet. Select Smtp or None.");
    }
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
app.Logger.ApiStarting(app.Environment.EnvironmentName, database.MigrateOnStartup, database.SeedDemoData, apiReference ? "on" : "off", app.Services.GetRequiredService<IOptions<AuthOptions>>().Value.Mode.ToString());

if (security.ForwardedHeaders.Enabled)
{
    app.UseForwardedHeaders();
}

app.UseMiddleware<RequestCorrelationMiddleware>();
app.UseMiddleware<AdminPreconditionHeadersMiddleware>();
app.UseExceptionHandler();
app.UseStatusCodePages();

if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("SystemTest") && !app.Environment.IsEnvironment("Demo"))
{
    app.UseHsts();
}

if (security.HttpsRedirection.Enabled)
{
    app.UseHttpsRedirection();
}

app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
// Grant the larger upload body limit only after authorization succeeds on endpoints marked with TriageImageBodyLimit.
app.Use(async (context, next) =>
{
    if (context.GetEndpoint()?.Metadata.GetMetadata<TriageImageBodyLimit>() is not null &&
        context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
    {
        limit.MaxRequestBodySize = TriageImageLimits.MaxUploadBodyBytes;
    }

    await next(context);
});
app.UseMiddleware<CurrentActorMiddleware>();

app.MapDefaultEndpoints();
if (apiReference)
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference(options => options
        .WithTitle("Keyloop Service Scheduler API")
        .WithDefaultHttpClient(ScalarTarget.Shell, ScalarClient.Curl)
        .ShowOperationId()
        .ExpandAllTags())
        .AllowAnonymous();
}

AuthUrls.MapLogin(app);
app.MapSchedulerEndpoints();

if (!BuildTimeOpenApi.IsActive)
{
    await DatabaseInitializer.InitializeAsync(app.Services, CancellationToken.None);
}

await app.RunAsync();

public partial class Program;

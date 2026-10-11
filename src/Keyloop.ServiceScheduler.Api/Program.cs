using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi("v1");

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

await app.RunAsync();

public partial class Program;

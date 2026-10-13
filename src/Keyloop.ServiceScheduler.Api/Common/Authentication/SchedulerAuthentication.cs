using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Authentication;

public static class SchedulerAuthentication
{
    public const string Scheme = "Scheduler";
    public const string BookingsWrite = "BookingsWrite";
    public const string AppointmentDetails = "AppointmentDetails";
    public const string Admin = "Admin";

    /// <summary>
    /// Deny by default. A mapped route that declares neither a policy nor <c>AllowAnonymous</c> is Admin-only, so a new endpoint
    /// that forgets its access decision fails closed (EndpointAuthorizationMapTests also fails the build's tests). A request that
    /// matched no route, or matched a path with the wrong method (the framework's 405 endpoint carries no route pattern), passes,
    /// so routing still answers it with 404 or 405 instead of a misleading 401.
    /// </summary>
    internal static AuthorizationPolicy DenyByDefault { get; } = new AuthorizationPolicyBuilder()
        .RequireAssertion(context => context.Resource is HttpContext http && http.GetEndpoint() is not RouteEndpoint
            || context.User.Identity?.IsAuthenticated == true && context.User.IsInRole(SchedulerRoles.Admin))
        .Build();

    public static IServiceCollection AddSchedulerAuthentication(this IServiceCollection services, IHostEnvironment environment)
    {
        services.AddOptions<AuthOptions>().BindConfiguration(AuthOptions.SectionName).ValidateOnStart();
        services.AddSingleton<IValidateOptions<AuthOptions>, AuthOptionsValidator>();
        services.AddSingleton<IValidateOptions<AuthOptions>>(new AuthEnvironmentValidator(environment.EnvironmentName));
#pragma warning disable EXTEXP0001
        services.AddHttpClient("AccessJwks", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(5);
            client.MaxResponseContentBufferSize = 64 * 1024;
        }).RemoveAllResilienceHandlers().RemoveAllLoggers()
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5) });
#pragma warning restore EXTEXP0001
        // Singleton owns the cache; pooled connections have a bounded lifetime for DNS refresh.
        services.AddSingleton(sp => new AccessSigningKeys(sp.GetRequiredService<IHttpClientFactory>().CreateClient("AccessJwks"),
            sp.GetRequiredService<IOptions<AuthOptions>>(), sp.GetRequiredService<TimeProvider>()));
        services.AddScoped<AccessTokenValidator>();
        services.AddTransient<IClaimsTransformation, RoleClaimsTransformation>();
        services.AddAuthentication(Scheme).AddScheme<AuthenticationSchemeOptions, SchedulerAuthenticationHandler>(Scheme, _ => { });
        services.AddAuthorizationBuilder()
            .AddPolicy(BookingsWrite, p => p.RequireAuthenticatedUser().RequireRole(SchedulerRoles.Admin, SchedulerRoles.ServiceAdvisor))
            .AddPolicy(AppointmentDetails, p => p.RequireAuthenticatedUser().RequireRole(SchedulerRoles.All))
            .AddPolicy(Admin, p => p.RequireAuthenticatedUser().RequireRole(SchedulerRoles.Admin))
            .SetFallbackPolicy(DenyByDefault);
        services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler, AuthorizationProblemHandler>();
        return services;
    }
}

/// <summary>Header first, hostname cookie second. No bearer header, test header or unverified edge identity grants access.</summary>
public sealed class SchedulerAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> schemes, ILoggerFactory logger, UrlEncoder encoder,
    IOptions<AuthOptions> auth, AccessTokenValidator validator)
    : AuthenticationHandler<AuthenticationSchemeOptions>(schemes, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var settings = auth.Value;
        if (settings.Mode == AuthMode.None)
        {
            return AuthenticateResult.NoResult();
        }

        if (settings.Mode == AuthMode.Development)
        {
            if (settings.Development.Roles.All(string.IsNullOrEmpty))
            {
                return AuthenticateResult.NoResult();
            }

            var identity = new ClaimsIdentity(Scheme.Name);
            identity.AddClaim(new Claim(ClaimTypes.Email, settings.Development.Email));
            identity.AddClaim(new Claim(ClaimTypes.Name, "Development user"));
            foreach (var role in settings.Development.Roles.Where(role => !string.IsNullOrEmpty(role)).Distinct(StringComparer.Ordinal))
            {
                identity.AddClaim(new Claim(ClaimTypes.Role, role));
            }

            return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
        }
        string? token;
        if (Request.Headers.TryGetValue("Cf-Access-Jwt-Assertion", out var assertions))
        {
            if (assertions.Count != 1 || string.IsNullOrWhiteSpace(assertions[0]))
            {
                return AuthenticateResult.Fail("Invalid Access identity.");
            }

            token = assertions[0];
        }
        else
        {
            token = Request.Cookies["CF_Authorization"];
        }

        if (string.IsNullOrEmpty(token))
        {
            return AuthenticateResult.NoResult();
        }

        try
        {
            var accepted = await validator.ValidateAsync(token, Context.RequestAborted);
            // The token's expiry travels with the ticket, where GET /me reads it for the web app's session renewal.
            return accepted is null ? AuthenticateResult.Fail("Invalid Access identity.")
                : AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(accepted.Identity),
                    new AuthenticationProperties { ExpiresUtc = accepted.ExpiresUtc }, Scheme.Name));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or ArgumentException or FormatException
            or InvalidOperationException or System.Security.Cryptography.CryptographicException)
        {
            // Do not attach the exception: transport and token exceptions can echo tokens or personal data.
            return AuthenticateResult.Fail("Access identity could not be verified.");
        }
    }
}

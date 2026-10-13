using System.ComponentModel;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

/// <summary>Transient personal-data search input, supplied only in the body.</summary>
public sealed record FindReturningCustomersRequest(string Query)
{
    /// <summary>Registration, email, phone or name; 2 to 100 characters after trimming.</summary>
    /// <example>AB12 CDE</example>
    public string Query { get; init; } = Query;
}

public sealed class FindReturningCustomersValidator : AbstractValidator<FindReturningCustomersRequest>
{
    public FindReturningCustomersValidator() => RuleFor(r => r.Query)
        .Must(q => q is not null && q.Trim().Length is >= 2 and <= 100)
        .WithMessage("query must be 2 to 100 characters after trimming.");
}

public sealed class FindReturningCustomersEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapPost("/dealerships/{dealershipId:guid}/customer-lookups", HandleAsync)
        .WithName("FindReturningCustomers").WithTags(ApiTags.Appointments)
        .RequireAuthorization(SchedulerAuthentication.BookingsWrite)
        .RequireRateLimiting(SchedulerRateLimiting.BookingPolicy)
        .AddEndpointFilter<ValidationFilter<FindReturningCustomersRequest>>()
        .Produces<IReadOnlyList<ReturningCustomerResponse>>().ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status401Unauthorized).ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status413PayloadTooLarge)
        .ProducesRateLimitedProblem();

    /// <summary>Find returning customers in this dealership's booking history</summary>
    /// <remarks>
    /// Admin or ServiceAdvisor only; no-store. Trim query to 2..100 characters. An @ selects a case-insensitive email prefix.
    /// At least six ASCII digits, outnumbering formatting characters, with only +, whitespace, parentheses or hyphens otherwise,
    /// selects phone: retain digits-only matching at either end; additionally normalize explicit +44/0044, +49/0049 or a single
    /// national trunk 0 on both stored number and query. Normalized matching needs six significant digits; normalized forward
    /// prefixes require that explicit format, while suffixes also accept bare digits. Otherwise search registration (uppercase,
    /// whitespace removed, prefix) and name (every whitespace-separated query word of at least three characters is a prefix
    /// of some name word, in any order; shorter words are ignored, and no eligible words disables name search).
    /// Prefixes are literal, including % and _. All appointment statuses count. Group by lower(email) and VIN
    /// within this dealership; an older match still returns the pair's latest booking by start UTC, then id. Visits counts all
    /// bookings of the pair. Return at most eight pairs by lastVisitUtc descending, then latest booking id descending.
    /// Only customer and vehicle intake fields are returned. Query is never stored, logged or traced; one event records kind and count.
    /// </remarks>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">Dealership whose booking history is searched.</param>
    /// <param name="request">Transient search body.</param>
    /// <param name="handler">Reads the history projection.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">Up to eight customer-and-vehicle pairs, latest visit first; an empty array when nothing matches.</response>
    /// <response code="400">query must be 2..100 trimmed characters (validation-error, errors.query); unreadable JSON is also 400.</response>
    /// <response code="401">Authentication required.</response>
    /// <response code="403">BookingsWrite role required (Admin or ServiceAdvisor).</response>
    /// <response code="404">Unknown dealership (not-found).</response>
    /// <response code="413">The request body exceeds the configured limit.</response>
    /// <response code="429">Too many requests (rate-limited, Retry-After).</response>
    internal static async Task<Ok<IReadOnlyList<ReturningCustomerResponse>>> HandleAsync(Guid dealershipId,
        [FromBody, Description("Transient body-only query: registration, email, phone or name, 2..100 trimmed characters.")] FindReturningCustomersRequest request,
        [FromServices] FindReturningCustomersHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(dealershipId, request, cancellationToken));
}

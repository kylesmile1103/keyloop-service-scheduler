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
    /// Searches the dealership's booking history by email prefix, phone number, registration prefix, or customer name word prefixes,
    /// returning up to eight customer-and-vehicle pairs ordered by most recent visit.
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

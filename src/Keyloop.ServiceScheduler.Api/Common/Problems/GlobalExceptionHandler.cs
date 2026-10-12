using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Domain.Common;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>
/// The only place exceptions become HTTP responses (SYSTEM_DESIGN §8.7): RFC 9457 problems with the catalogue's type and title,
/// <c>instance</c> = request path and <c>traceId</c> (added by the problem details writer). Anything unexpected is a 500
/// <c>internal-error</c> whose body never carries exception details; it is logged here (event 1200) because the exception
/// handler middleware does not log exceptions an <see cref="IExceptionHandler"/> handled.
/// </summary>
public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    private const string UnexpectedDetail = "An unexpected error occurred.";

    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(exception);

        // The client went away: nobody reads a body. (The middleware already answers 499 itself before calling handlers; this
        // keeps the mapping total.) A cancellation the client did not ask for is a server fault and falls through to 500.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            httpContext.Response.StatusCode = StatusCodes.Status499ClientClosedRequest;
            return true;
        }

        var problem = Map(exception);
        if (problem.Status == StatusCodes.Status500InternalServerError)
        {
            logger.UnhandledException(exception, httpContext.Request.Method, httpContext.Request.Path);
        }

        problem.Instance = httpContext.Request.Path;
        httpContext.Response.StatusCode = problem.Status!.Value;

        // Not written when the client's Accept header excludes JSON. The mapped status still stands: reporting "not handled" would
        // make the middleware rethrow and turn, say, a 422 into a 500.
        await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = problem });
        return true;
    }

    private static ProblemDetails Map(Exception exception) => exception switch
    {
        DomainRuleViolationException rule => Problem(
            StatusCodes.Status422UnprocessableEntity, ProblemTypes.ForRule(rule.RuleCode), rule.Message, [.. rule.Extensions]),
        InvalidStateTransitionException transition => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.InvalidStateTransition, transition.Message,
            [new("currentStatus", transition.Current), new("attempted", transition.Attempted)]),
        NotFoundException notFound => Problem(
            StatusCodes.Status404NotFound, ProblemTypes.NotFound, notFound.Message, [new("resource", notFound.Resource), new("id", notFound.Id)]),

        // Extensions are serialised by runtime type, so suggestions are copied into the array type SchedulerJsonContext lists.
        SlotUnavailableException unavailable => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.SlotUnavailable, unavailable.Message, [new("suggestedSlots", unavailable.Suggestions.ToArray())]),
        SlotConflictException conflict => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.SlotConflict, conflict.Message,
            [new("suggestedSlots", conflict.Suggestions.ToArray()), new("conflictingResource", conflict.ConflictingResource)]),
        IdempotencyKeyReuseException reuse => Problem(StatusCodes.Status422UnprocessableEntity, ProblemTypes.IdempotencyKeyReuse, reuse.Message),
        DbUpdateConcurrencyException => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.ConcurrencyConflict, "The resource was changed by another request after it was read. Reload it and retry."),

        // Binding failures (a missing or malformed parameter, unreadable JSON) that the framework rejects itself:
        // RouteHandlerOptions.ThrowOnBadRequest is on in every environment, so those arrive here rather than as a bare 400. Not every
        // malformed value does: on an endpoint with a filter, a nullable parameter that fails to parse binds as null and the request
        // continues to the filters, so ValidationFilter answers it with a field-keyed validation-error instead (e.g. availability's
        // serviceTypeId=not-a-guid). The framework's message names C# types, so the detail here is generic. validation-error always
        // carries `errors` (§8.7); a binding failure names no field, so it is empty.
        BadHttpRequestException { StatusCode: StatusCodes.Status400BadRequest } => Problem(
            new HttpValidationProblemDetails(), StatusCodes.Status400BadRequest, ProblemTypes.ValidationError,
            "The request could not be read: a parameter is missing or malformed, or the body is not valid JSON."),
        BadHttpRequestException other => new ProblemDetails { Status = other.StatusCode }, // e.g. 413: the framework's default type and title for the status

        _ => Problem(StatusCodes.Status500InternalServerError, ProblemTypes.InternalError, UnexpectedDetail),
    };

    private static ProblemDetails Problem(int status, string type, string detail, KeyValuePair<string, object?>[]? extensions = null) =>
        Problem(new ProblemDetails(), status, type, detail, extensions);

    private static ProblemDetails Problem(ProblemDetails problem, int status, string type, string detail, KeyValuePair<string, object?>[]? extensions = null)
    {
        problem.Status = status;
        problem.Type = type;
        problem.Title = ProblemTypes.TitleFor(type) ?? ProblemTypes.UncataloguedRuleTitle;
        problem.Detail = detail;
        foreach (var (key, value) in extensions ?? [])
        {
            problem.Extensions[key] = value;
        }

        return problem;
    }
}

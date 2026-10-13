using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>Maps domain and application exceptions to RFC 9457 ProblemDetails responses.</summary>
public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    private const string UnexpectedDetail = "An unexpected error occurred.";

    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(exception);

        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            httpContext.Response.StatusCode = StatusCodes.Status499ClientClosedRequest;
            return true;
        }

        var endpoint = httpContext.GetEndpoint() ?? httpContext.Features.Get<IExceptionHandlerFeature>()?.Endpoint;
        var problem = Map(exception, endpoint?.Metadata.GetMetadata<AdminEditingMetadata>() is not null);
        if (problem.Status == StatusCodes.Status500InternalServerError)
        {
            logger.UnhandledException(exception, httpContext.Request.Method, httpContext.Request.Path);
        }

        if (exception is AdminPreconditionException { CurrentETag: { } tag })
        {
            httpContext.Response.Headers.ETag = tag;
            httpContext.Items[typeof(AdminPreconditionException)] = tag;
        }
        problem.Instance = httpContext.Request.Path;
        httpContext.Response.StatusCode = problem.Status!.Value;
        if (exception is TriageUnavailableException { RetryAfterSeconds: { } seconds })
        {
            httpContext.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        }

        await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = problem });
        return true;
    }

    private static ProblemDetails Map(Exception exception, bool adminFieldErrors) => exception switch
    {
        AdminFieldException input => Problem(new HttpValidationProblemDetails(new Dictionary<string, string[]>
            { [input.Field] = [input.Message] }), StatusCodes.Status400BadRequest, ProblemTypes.ValidationError, "One or more fields are invalid."),
        AdminPreconditionException precondition => Problem(precondition.Status,
            precondition.Status == 428 ? ProblemTypes.PreconditionRequired : ProblemTypes.PreconditionFailed, precondition.Message,
            precondition.Status == 412 ? [new("currentETag", precondition.CurrentETag), new("current", precondition.Current)] : []),
        TriageInputException input => Problem(new HttpValidationProblemDetails(new Dictionary<string, string[]>
            { [input.Field] = [input.Message] }), StatusCodes.Status400BadRequest, ProblemTypes.ValidationError, "One or more fields are invalid."),
        TriageUnavailableException unavailable => Problem(StatusCodes.Status503ServiceUnavailable, ProblemTypes.TriageUnavailable, unavailable.Message),
        DomainRuleViolationException rule => Problem(
            StatusCodes.Status422UnprocessableEntity, ProblemTypes.ForRule(rule.RuleCode), rule.Message, [.. rule.Extensions]),
        InvalidStateTransitionException transition => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.InvalidStateTransition, transition.Message,
            [new("currentStatus", transition.Current), new("attempted", transition.Attempted)]),
        NotFoundException notFound => Problem(
            StatusCodes.Status404NotFound, ProblemTypes.NotFound, notFound.Message, [new("resource", notFound.Resource), new("id", notFound.Id)]),

        SlotUnavailableException unavailable => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.SlotUnavailable, unavailable.Message, [new("suggestedSlots", unavailable.Suggestions.ToArray())]),
        SlotConflictException conflict => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.SlotConflict, conflict.Message,
            [new("suggestedSlots", conflict.Suggestions.ToArray()), new("conflictingResource", conflict.ConflictingResource)]),
        IdempotencyKeyReuseException reuse => Problem(StatusCodes.Status422UnprocessableEntity, ProblemTypes.IdempotencyKeyReuse, reuse.Message),
        PolicyPreviewOutdatedException outdated => Problem(StatusCodes.Status409Conflict, ProblemTypes.PolicyPreviewOutdated, outdated.Message),
        BookingPolicyChurnException churn => Problem(StatusCodes.Status409Conflict, ProblemTypes.ConcurrencyConflict, churn.Message),
        DbUpdateConcurrencyException => Problem(
            StatusCodes.Status409Conflict, ProblemTypes.ConcurrencyConflict, "The resource was changed by another request after it was read. Reload it and retry."),

        BadHttpRequestException { StatusCode: StatusCodes.Status400BadRequest } binding => Problem(
            new HttpValidationProblemDetails(adminFieldErrors ? BindingErrors(binding) : []), StatusCodes.Status400BadRequest, ProblemTypes.ValidationError,
            "The request could not be read: a parameter is missing or malformed, or the body is not valid JSON."),
        BadHttpRequestException other => new ProblemDetails { Status = other.StatusCode },

        _ => Problem(StatusCodes.Status500InternalServerError, ProblemTypes.InternalError, UnexpectedDetail),
    };

    private static Dictionary<string, string[]> BindingErrors(Exception exception)
    {
        // Retain a bounded JSON field path with generic text for malformed typed request bodies.
        for (var current = exception.InnerException; current is not null; current = current.InnerException)
        {
            if (current is JsonException { Path: { } path } && path.Length <= 256 && path.StartsWith("$.", StringComparison.Ordinal))
            {
                var field = path[2..];
                if (field.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '[' or ']' or '_'))
                {
                    return new(StringComparer.Ordinal) { [field] = ["This field is missing or could not be read in the documented format."] };
                }
            }
        }
        return [];
    }

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

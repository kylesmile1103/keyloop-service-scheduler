using Microsoft.AspNetCore.Http.HttpResults;

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>Problem results an endpoint returns directly (rather than throwing). Written through <c>IProblemDetailsService</c>, so <c>traceId</c> and <c>instance</c> are added.</summary>
public static class ProblemResults
{
    /// <summary>400 <c>validation-error</c> with <c>errors: { field: [messages] }</c>; keys are the JSON property paths (e.g. <c>customer.email</c>).</summary>
    public static ValidationProblem Validation(IDictionary<string, string[]> errors) =>
        TypedResults.ValidationProblem(
            errors,
            detail: "One or more fields are invalid.",
            title: ProblemTypes.TitleFor(ProblemTypes.ValidationError),
            type: ProblemTypes.ValidationError);
}

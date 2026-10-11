using System.Text.Json;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Problems;

namespace Keyloop.ServiceScheduler.Api.Common.Validation;

/// <summary>
/// Validates the endpoint's <typeparamref name="T"/> argument with its registered <see cref="IValidator{T}"/> (validators are
/// registered explicitly in <c>Program.cs</c>) and short-circuits with 400 <c>validation-error</c> on failure. Error keys are the
/// camelCase JSON paths of the offending properties (<c>customer.email</c>), not C# property paths.
/// </summary>
/// <example><c>group.MapPost("/dealerships/{dealershipId:guid}/appointments", Handle).AddEndpointFilter&lt;ValidationFilter&lt;BookAppointmentRequest&gt;&gt;();</c></example>
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        T? argument = null;
        foreach (var candidate in context.Arguments)
        {
            if (candidate is T match)
            {
                argument = match;
                break;
            }
        }

        if (argument is null)
        {
            throw new InvalidOperationException($"ValidationFilter<{typeof(T).Name}> is applied to an endpoint without a {typeof(T).Name} argument.");
        }

        var validator = context.HttpContext.RequestServices.GetRequiredService<IValidator<T>>();
        var result = await validator.ValidateAsync(argument, context.HttpContext.RequestAborted);
        if (result.IsValid)
        {
            return await next(context);
        }

        var errors = result.Errors
            .GroupBy(failure => JsonPath(failure.PropertyName), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(failure => failure.ErrorMessage).Distinct(StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);
        return ProblemResults.Validation(errors);
    }

    /// <summary><c>Customer.Email</c> → <c>customer.email</c>; <c>Lines[0].Code</c> → <c>lines[0].code</c>.</summary>
    private static string JsonPath(string propertyName) =>
        string.Join('.', propertyName.Split('.').Select(segment => JsonNamingPolicy.CamelCase.ConvertName(segment)));
}

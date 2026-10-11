using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class ValidationFilterTests
{
    [Fact]
    public async Task Invalid_argument_short_circuits_with_a_400_validation_problem_keyed_by_json_property_paths()
    {
        var (result, nextCalled) = await InvokeAsync(new ProbeRequest(Name: "", Customer: new ProbeCustomer(Email: "not-an-email")));

        nextCalled.ShouldBeFalse();
        var problem = result.ShouldBeOfType<ValidationProblem>();
        problem.StatusCode.ShouldBe(400);
        problem.ProblemDetails.Type.ShouldBe(ProblemTypes.ValidationError);
        problem.ProblemDetails.Title.ShouldBe("Validation failed");
        problem.ProblemDetails.Detail.ShouldBe("One or more fields are invalid.");

        // FluentValidation names properties in C# (Customer.Email); clients see the camelCase JSON path.
        problem.ProblemDetails.Errors.Keys.ShouldBe(["name", "customer.email"], ignoreOrder: true);
        problem.ProblemDetails.Errors["customer.email"].ShouldBe(["Customer Email is not a valid email address."]);
    }

    [Fact]
    public async Task Valid_argument_reaches_the_handler()
    {
        var (result, nextCalled) = await InvokeAsync(new ProbeRequest("Alex", new ProbeCustomer("alex.morgan@example.com")));

        nextCalled.ShouldBeTrue();
        result.ShouldBe("handled");
    }

    [Fact]
    public async Task Endpoint_without_the_validated_argument_is_a_programming_error()
    {
        var http = new DefaultHttpContext { RequestServices = Services() };
        var context = EndpointFilterInvocationContext.Create(http, "not the request");

        await Should.ThrowAsync<InvalidOperationException>(async () =>
            await new ValidationFilter<ProbeRequest>().InvokeAsync(context, _ => ValueTask.FromResult<object?>(null)));
    }

    private static async Task<(object? Result, bool NextCalled)> InvokeAsync(ProbeRequest request)
    {
        var http = new DefaultHttpContext { RequestServices = Services() };
        var context = EndpointFilterInvocationContext.Create(http, request);
        var nextCalled = false;
        var result = await new ValidationFilter<ProbeRequest>().InvokeAsync(context, _ =>
        {
            nextCalled = true;
            return ValueTask.FromResult<object?>("handled");
        });
        return (result, nextCalled);
    }

    private static ServiceProvider Services() =>
        new ServiceCollection().AddSingleton<IValidator<ProbeRequest>, ProbeRequestValidator>().BuildServiceProvider();

    public sealed record ProbeRequest(string? Name, ProbeCustomer? Customer);

    public sealed record ProbeCustomer(string? Email);

    private sealed class ProbeRequestValidator : AbstractValidator<ProbeRequest>
    {
        public ProbeRequestValidator()
        {
            RuleFor(r => r.Name).NotEmpty();
            RuleFor(r => r.Customer!.Email).EmailAddress().WithMessage("Customer Email is not a valid email address.").When(r => r.Customer is not null);
        }
    }
}

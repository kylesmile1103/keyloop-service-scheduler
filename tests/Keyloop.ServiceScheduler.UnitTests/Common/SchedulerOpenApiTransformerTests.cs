using System.ComponentModel;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

/// <summary>
/// The guards inside SchedulerOpenApi's schema and operation transformers that the served document cannot exercise (the integration
/// contract tests cover what the real document says).
/// </summary>
public sealed class SchedulerOpenApiTransformerTests : IDisposable
{
    private static readonly JsonSerializerOptions Options = new();

    private readonly ServiceProvider _services = new ServiceCollection().BuildServiceProvider();

    public void Dispose() => _services.Dispose();

    [Fact]
    public async Task An_enum_schema_is_typed_string_only_when_every_value_is_a_string()
    {
        var byName = new OpenApiSchema { Enum = [JsonValue.Create("Confirmed"), JsonValue.Create("Cancelled")] };
        var byNumber = new OpenApiSchema { Enum = [JsonValue.Create(0), JsonValue.Create(1)] };

        await SchedulerOpenApi.TypeStringEnums(byName, SchemaContext(SchedulerJsonContext.Default.AppointmentStatus), CancellationToken.None);
        await SchedulerOpenApi.TypeStringEnums(byNumber, SchemaContext(SchedulerJsonContext.Default.AppointmentStatus), CancellationToken.None);

        byName.Type.ShouldBe(JsonSchemaType.String);
        byNumber.Type.ShouldBeNull("an enum written as numbers must not be documented as strings");
    }

    [Fact]
    public async Task Problem_schemas_require_a_trace_id_and_other_schemas_are_left_alone()
    {
        var problem = new OpenApiSchema { Properties = new Dictionary<string, IOpenApiSchema> { ["type"] = new OpenApiSchema() } };
        var validation = new OpenApiSchema();
        var appointment = new OpenApiSchema();

        // Applied twice, as a transformer may be for a schema used in several places: still one property, one requirement.
        await SchedulerOpenApi.DocumentProblemTraceId(problem, SchemaContext(JsonTypeInfo.CreateJsonTypeInfo<ProblemDetails>(Options)), CancellationToken.None);
        await SchedulerOpenApi.DocumentProblemTraceId(problem, SchemaContext(JsonTypeInfo.CreateJsonTypeInfo<ProblemDetails>(Options)), CancellationToken.None);
        await SchedulerOpenApi.DocumentProblemTraceId(validation, SchemaContext(JsonTypeInfo.CreateJsonTypeInfo<HttpValidationProblemDetails>(Options)), CancellationToken.None);
        await SchedulerOpenApi.DocumentProblemTraceId(appointment, SchemaContext(SchedulerJsonContext.Default.AppointmentResponse), CancellationToken.None);

        foreach (var schema in new[] { problem, validation })
        {
            var traceId = schema.Properties.ShouldNotBeNull()["traceId"].ShouldBeOfType<OpenApiSchema>();
            traceId.Type.ShouldBe(JsonSchemaType.String);
            traceId.Description.ShouldNotBeNullOrWhiteSpace();
            schema.Required.ShouldBe(["traceId"]);
        }

        problem.Properties!.Keys.ShouldBe(["type", "traceId"]);
        appointment.Properties.ShouldBeNull();
        appointment.Required.ShouldBeNull();
    }

    [Fact]
    public async Task A_request_body_is_described_by_its_parameters_description_attribute()
    {
        // As the XML-comment transformer leaves it: described by the last <param> that names no operation parameter.
        var operation = new OpenApiOperation { OperationId = "BookAppointment", RequestBody = new OpenApiRequestBody { Description = "Cancelled when the client disconnects." } };
        var parameter = ((Action<object>)(([Description("The booking.")] request) => { })).Method.GetParameters()[0];

        await SchedulerOpenApi.DescribeRequestBody(operation, OperationContext(BodyParameter(parameter)), CancellationToken.None);

        operation.RequestBody.Description.ShouldBe("The booking.");
    }

    [Fact]
    public async Task A_request_body_without_a_description_attribute_fails_document_generation()
    {
        var operation = new OpenApiOperation { OperationId = "CancelAppointment", RequestBody = new OpenApiRequestBody { Description = "Cancelled when the client disconnects." } };
        var parameter = ((Action<object>)(request => { })).Method.GetParameters()[0];

        var failure = await Should.ThrowAsync<InvalidOperationException>(
            () => SchedulerOpenApi.DescribeRequestBody(operation, OperationContext(BodyParameter(parameter)), CancellationToken.None));

        failure.Message.ShouldContain("CancelAppointment");
        failure.Message.ShouldContain("[Description]");
    }

    [Fact]
    public async Task An_operation_without_a_request_body_is_left_alone()
    {
        var operation = new OpenApiOperation { OperationId = "GetDealerships" };

        await SchedulerOpenApi.DescribeRequestBody(operation, OperationContext(), CancellationToken.None);

        operation.RequestBody.ShouldBeNull();
    }

    private OpenApiSchemaTransformerContext SchemaContext(JsonTypeInfo typeInfo) => new()
    {
        DocumentName = SchedulerOpenApi.DocumentName,
        JsonTypeInfo = typeInfo,
        JsonPropertyInfo = null,
        ParameterDescription = null,
        ApplicationServices = _services,
    };

    private OpenApiOperationTransformerContext OperationContext(params ApiParameterDescription[] parameters)
    {
        var description = new ApiDescription();
        foreach (var parameter in parameters)
        {
            description.ParameterDescriptions.Add(parameter);
        }

        return new OpenApiOperationTransformerContext { DocumentName = SchedulerOpenApi.DocumentName, Description = description, ApplicationServices = _services };
    }

    private static ApiParameterDescription BodyParameter(ParameterInfo parameter) => new()
    {
        Name = parameter.Name!,
        Source = BindingSource.Body,
        ParameterDescriptor = new ParameterInfoDescriptor { Name = parameter.Name!, ParameterType = parameter.ParameterType, ParameterInfo = parameter },
    };

    private sealed class ParameterInfoDescriptor : ParameterDescriptor, IParameterInfoParameterDescriptor
    {
        public required ParameterInfo ParameterInfo { get; init; }
    }
}

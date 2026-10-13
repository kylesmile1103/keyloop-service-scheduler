using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Shared;

internal static class AdminOpenApiExamples
{
    public static Task DescribeAsync(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken ct)
    {
        if (context.JsonTypeInfo.Type == typeof(TechnicianWriteRequest))
        {
            BoundItems(schema, "brandSpecialisms", 16);
            schema.Examples = [JsonSerializer.SerializeToNode(new TechnicianWriteRequest("Alex Technician", "T-NEW",
                [Certification.GeneralService, Certification.Brakes], true, 2, new(2028, 12, 31), true, ["VOLKSWAGEN"]),
                SchedulerJsonContext.Default.TechnicianWriteRequest)!];
        }
        else if (context.JsonTypeInfo.Type == typeof(BayWriteRequest))
        {
            schema.Examples = [JsonSerializer.SerializeToNode(new BayWriteRequest("Bay - Standard", [BayCapability.StandardLift], true),
                SchedulerJsonContext.Default.BayWriteRequest)!];
        }
        else if (context.JsonTypeInfo.Type == typeof(PolicyWriteRequest))
        {
            BoundItems(schema, "rules", 32);
            schema.Examples = [JsonSerializer.SerializeToNode(new PolicyWriteRequest([new RequirementRuleInput("hv-routine", 20,
                RequirementCondition.ServicePowertrain, [Powertrain.BatteryElectric, Powertrain.Unknown], ["INTERIM-SERVICE"], null,
                3, [], [])], true, new(2026, 10, 13)), SchedulerJsonContext.Default.PolicyWriteRequest)!];
        }
        return Task.CompletedTask;
    }

    private static void BoundItems(OpenApiSchema schema, string property, int maximum)
    {
        if (schema.Properties is { } properties && properties.TryGetValue(property, out var value) && value is OpenApiSchema array)
        {
            array.MaxItems = maximum;
        }
    }
}

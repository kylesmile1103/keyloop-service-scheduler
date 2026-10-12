using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

/// <summary><c>GET /api/v1/dealerships/{dealershipId}/appointments?from=&amp;to=&amp;status=</c>: a local date-range history read.</summary>
public sealed class ListAppointmentsEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/appointments", HandleAsync)
            .WithName("ListAppointments")
            .WithTags(ApiTags.Appointments)
            .AddEndpointFilter<ValidationFilter<ListAppointmentsQuery>>()
            .Produces<IReadOnlyList<AppointmentListItemResponse>>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem()
            .AddOpenApiOperationTransformer((operation, _, _) =>
            {
                // Bind text for field-keyed validation, but give generated clients the precise allowed status names and repeat syntax.
                var status = operation.Parameters!.OfType<OpenApiParameter>().Single(p => p.Name == "status");
                status.Required = false;
                status.Style = ParameterStyle.Form;
                status.Explode = true;
                status.Example = new JsonArray("Confirmed", "Completed");
                status.Schema = new OpenApiSchema
                {
                    Type = JsonSchemaType.Array,
                    Items = new OpenApiSchema
                    {
                        Type = JsonSchemaType.String,
                        Enum = Enum.GetNames<AppointmentStatus>().Select(name => (JsonNode)JsonValue.Create(name)!).ToList(),
                    },
                };
                return Task.CompletedTask;
            });

    // As on GetWorkshopSchedule, XML param tags name the flattened [AsParameters] properties for the OpenAPI generator.
#pragma warning disable CS1572
    /// <summary>List appointments for a local date range</summary>
    /// <remarks>
    /// Selects appointments whose start date in the dealership's time zone falls between from and to, both inclusive, at most
    /// 62 calendar days. Reads any status, including cancelled appointments, unless status is supplied; repeat it to select a
    /// union, for example by supplying both <c>status=Confirmed</c> and <c>status=Completed</c>. Ordered by start UTC, then id for equal starts.
    /// Opening hours do not restrict the read. Local times carry the zone's offset, including both occurrences of a fall-back
    /// hour. Callers without an API role receive customer initials and only the last six VIN characters.
    /// Callers with Admin, ServiceAdvisor or Viewer receive full names and VINs. Registration plates remain visible. Returns an empty array when there are no matches.
    /// </remarks>
    /// <param name="query">The route and query parameters below, validated before the handler runs.</param>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">The dealership whose appointments are read (the seeded Reading dealership in the example).</param>
    /// <param name="from" example="2026-10-12">First inclusive local date, exactly <c>yyyy-MM-dd</c>.</param>
    /// <param name="to" example="2026-10-25">Last inclusive local date, exactly <c>yyyy-MM-dd</c>; on or after from, spanning at most 62 calendar dates including both bounds.</param>
    /// <param name="status" example="Confirmed">Optional, repeatable, case-sensitive status names: Confirmed, CheckedIn, InProgress, Completed, Cancelled, NoShow. Omit to read every status.</param>
    /// <param name="httpContext">Supplies the caller for the customer/VIN audience-policy seam.</param>
    /// <param name="handler">Reads the range projection.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">An array of appointments ordered by start, with service, bay and technician summaries, masked customer initials and VIN suffixes; empty when there are no matches.</response>
    /// <response code="400">Missing or malformed dates, from after to, more than 62 inclusive days, or an invalid status (<c>validation-error</c>, with <c>errors</c> keyed <c>from</c>, <c>to</c> or <c>status</c>).</response>
    /// <response code="404">No dealership has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> and the <c>id</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<IReadOnlyList<AppointmentListItemResponse>>> HandleAsync(
        [AsParameters] ListAppointmentsQuery query, HttpContext httpContext, [FromServices] ListAppointmentsHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(query, httpContext.User, cancellationToken));
#pragma warning restore CS1572
}

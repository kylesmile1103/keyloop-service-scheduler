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
            .AllowAnonymous()
            .WithTags(ApiTags.Appointments)
            .AddEndpointFilter<ValidationFilter<ListAppointmentsQuery>>()
            .Produces<IReadOnlyList<AppointmentListItemResponse>>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem()
            .AddOpenApiOperationTransformer((operation, _, _) =>
            {
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

#pragma warning disable CS1572
    /// <summary>List appointments for a local date range</summary>
    /// <remarks>
    /// Returns appointments starting between <c>from</c> and <c>to</c> (inclusive, up to 62 calendar days) in the dealership's time zone, optionally filtered by status.
    /// Callers with Admin, ServiceAdvisor, or Viewer receive full customer names, VINs, and registrations; other callers receive masked values (<c>ALS</c>, <c>***********123456</c>, and <c>*******</c>).
    /// </remarks>
    /// <param name="query">The route and query parameters below, validated before the handler runs.</param>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">The dealership whose appointments are read (the seeded Reading dealership in the example).</param>
    /// <param name="from" example="2026-10-12">First inclusive local date, exactly <c>yyyy-MM-dd</c>.</param>
    /// <param name="to" example="2026-10-25">Last inclusive local date, exactly <c>yyyy-MM-dd</c>; on or after from, spanning at most 62 calendar dates including both bounds.</param>
    /// <param name="status" example="Confirmed">Optional, repeatable, case-sensitive status names: Confirmed, CheckedIn, InProgress, Completed, Cancelled, NoShow. Omit to read every status.</param>
    /// <param name="httpContext">Supplies the caller, whose roles decide full or masked personal data.</param>
    /// <param name="handler">Reads the range projection.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">An array of appointments ordered by start, then id, with service, bay and technician summaries and the customer name, VIN and registration (masked for callers without an API role); empty when there are no matches.</response>
    /// <response code="400">Missing or malformed dates, from after to, more than 62 inclusive days, or an invalid status (<c>validation-error</c>, with <c>errors</c> keyed <c>from</c>, <c>to</c> or <c>status</c>).</response>
    /// <response code="404">No dealership has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> and the <c>id</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<IReadOnlyList<AppointmentListItemResponse>>> HandleAsync(
        [AsParameters] ListAppointmentsQuery query, HttpContext httpContext, [FromServices] ListAppointmentsHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(query, httpContext.User, cancellationToken));
#pragma warning restore CS1572
}

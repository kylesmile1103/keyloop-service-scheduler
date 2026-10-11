namespace Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

/// <summary>
/// What a reseed did: the demo dealerships' appointments it deleted (in every status) and the demo week's appointments it booked. Not
/// part of the OpenAPI contract: only the Aspire dashboard's command reads it.
/// </summary>
public sealed record ReseedDemoDataResponse(int AppointmentsDeleted, int AppointmentsCreated);

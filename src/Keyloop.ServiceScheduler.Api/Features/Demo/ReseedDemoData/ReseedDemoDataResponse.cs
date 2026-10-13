namespace Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;

/// <summary>Counts of deleted and re-created demo appointments returned by the demo reseed endpoint.</summary>
public sealed record ReseedDemoDataResponse(int AppointmentsDeleted, int AppointmentsCreated);

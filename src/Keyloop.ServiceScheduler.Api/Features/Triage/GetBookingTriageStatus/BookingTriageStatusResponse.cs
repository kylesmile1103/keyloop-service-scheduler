namespace Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;

/// <summary>Feature discovery for the booking dialog. Disabled triage leaves manual booking available.</summary>
/// <param name="Enabled">Whether service suggestions are enabled on this API.</param>
/// <param name="Model">Configured model identifier.</param>
/// <param name="Provider">Provider display attribution.</param>
/// <param name="MaxDescriptionLength">Maximum trimmed description length.</param>
public sealed record BookingTriageStatusResponse(bool Enabled, string Model, string Provider, int MaxDescriptionLength);

namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>An alternative start time offered when the requested slot cannot be booked (<c>suggestedSlots</c> on 409 problems).</summary>
/// <param name="StartUtc">Start of the suggested slot (UTC).</param>
/// <param name="EndUtc">End of the suggested slot (UTC, exclusive).</param>
/// <param name="StartLocal">The start in the dealership's local time, ISO-8601 with offset, for display.</param>
public sealed record SuggestedSlot(DateTime StartUtc, DateTime EndUtc, string StartLocal);

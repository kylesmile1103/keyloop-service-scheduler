namespace Keyloop.ServiceScheduler.Api.Common.Contracts;

/// <summary>The dealership's opening hours on the requested date, as UTC instants and as local wall-clock times.</summary>
/// <param name="StartUtc">Opening time (inclusive), UTC.</param>
/// <param name="EndUtc">Closing time (exclusive), UTC; equal to <c>startUtc</c> when the opening hours fall entirely in a daylight-saving gap.</param>
/// <param name="OpensAtLocal">Opening time as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, after daylight-saving resolution (a time skipped by the clocks moves to the first valid one).</param>
/// <param name="ClosesAtLocal">Closing time as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, after daylight-saving resolution.</param>
public sealed record OperatingWindowResponse(DateTime StartUtc, DateTime EndUtc, string OpensAtLocal, string ClosesAtLocal);

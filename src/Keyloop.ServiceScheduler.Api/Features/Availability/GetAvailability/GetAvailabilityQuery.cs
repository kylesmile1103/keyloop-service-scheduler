using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>
/// The route and query of <c>GET /dealerships/{dealershipId}/availability</c>, bound with <c>[AsParameters]</c> and checked by
/// <see cref="GetAvailabilityValidator"/> before the handler runs. <see cref="ServiceTypeId"/> and <see cref="Date"/> bind as
/// nullable, and the date as text, so that a missing or malformed value is a 400 <c>validation-error</c> naming the field: a
/// <see cref="DateOnly"/> parameter would accept culture-dependent forms such as <c>10/13/2026</c> and fail on others without one.
/// </summary>
/// <remarks>
/// <para>
/// Init-only properties rather than a positional record: the Request Delegate Generator (ASP.NET Core 10.0) emits
/// <c>typeof(string?)</c>, which does not compile, when an <c>[AsParameters]</c> constructor takes a nullable reference type.
/// </para>
/// <para>
/// <c>[Required]</c> and <c>[DataType(DataType.Date)]</c> only document the contract (<c>required: true</c>; <c>format: date</c>,
/// see <c>SchedulerOpenApi</c>): no DataAnnotations validation runs, the validator enforces both. Descriptions and examples of the
/// parameters are the <c>&lt;param&gt;</c> tags on <see cref="GetAvailabilityEndpoint"/>'s handler.
/// </para>
/// </remarks>
public sealed record GetAvailabilityQuery
{
    /// <summary>The only accepted form of <see cref="Date"/> (RFC 3339 full-date), parsed with the invariant culture.</summary>
    public const string DateFormat = "yyyy-MM-dd";

    /// <summary>The dealership whose bays, technicians and opening hours are used.</summary>
    [FromRoute(Name = "dealershipId")]
    public Guid DealershipId { get; init; }

    /// <summary>The service to fit; required.</summary>
    [FromQuery(Name = "serviceTypeId")]
    [Required]
    public Guid? ServiceTypeId { get; init; }

    /// <summary>The dealership's local calendar date, exactly <see cref="DateFormat"/>; required.</summary>
    [FromQuery(Name = "date")]
    [Required]
    [DataType(DataType.Date)]
    public string? Date { get; init; }

    /// <summary><see cref="Date"/> parsed strictly as <see cref="DateFormat"/>, or null when it is missing or in any other form.</summary>
    public DateOnly? LocalDate =>
        DateOnly.TryParseExact(Date, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}

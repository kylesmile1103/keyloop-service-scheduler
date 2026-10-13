using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary>Route and query parameters for <c>GET /dealerships/{dealershipId}/schedule</c>.</summary>
public sealed record GetWorkshopScheduleQuery
{
    /// <summary>Expected RFC 3339 full-date format for <see cref="Date"/>.</summary>
    public const string DateFormat = "yyyy-MM-dd";

    /// <summary>The dealership whose board is read.</summary>
    [FromRoute(Name = "dealershipId")]
    public Guid DealershipId { get; init; }

    /// <summary>The dealership's local calendar date, exactly <see cref="DateFormat"/>; required.</summary>
    [FromQuery(Name = "date")]
    [Required]
    [DataType(DataType.Date)]
    public string? Date { get; init; }

    /// <summary><see cref="Date"/> parsed strictly as <see cref="DateFormat"/>, or null when it is missing or in any other form.</summary>
    public DateOnly? LocalDate =>
        DateOnly.TryParseExact(Date, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}

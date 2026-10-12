using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

/// <summary>
/// The route and query parameters for the range read. Dates and statuses bind as text so malformed values reach the validator
/// and produce field-keyed 400 validation errors, as on GetWorkshopSchedule. Date annotations document the OpenAPI contract only.
/// </summary>
public sealed record ListAppointmentsQuery
{
    public const string DateFormat = "yyyy-MM-dd";
    public const int MaxDays = 62;

    [FromRoute(Name = "dealershipId")]
    public Guid DealershipId { get; init; }

    [FromQuery(Name = "from")]
    [Required]
    [DataType(DataType.Date)]
    public string? From { get; init; }

    [FromQuery(Name = "to")]
    [Required]
    [DataType(DataType.Date)]
    public string? To { get; init; }

    /// <summary>Optional, repeatable status names. An empty array means every status.</summary>
    [FromQuery(Name = "status")]
    public string[] Status { get; init; } = [];

    public DateOnly? LocalFrom => Parse(From);
    public DateOnly? LocalTo => Parse(To);

    private static DateOnly? Parse(string? value) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}

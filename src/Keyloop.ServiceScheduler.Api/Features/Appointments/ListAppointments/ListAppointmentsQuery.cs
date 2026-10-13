using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

/// <summary>Route and query parameters for listing appointments over a local date range.</summary>
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

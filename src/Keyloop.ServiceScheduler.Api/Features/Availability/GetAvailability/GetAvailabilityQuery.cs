using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>Route and query parameters for <c>GET /dealerships/{dealershipId}/availability</c>.</summary>
public sealed record GetAvailabilityQuery
{
    /// <summary>Expected RFC 3339 full-date format for <see cref="Date"/>.</summary>
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

    /// <summary>Optional powertrain, including Unknown. No VIN is accepted in a URL.</summary>
    [FromQuery(Name = "powertrain")]
    [EnumDataType(typeof(Domain.Scheduling.Powertrain))]
    public string? Powertrain { get; init; }

    /// <summary>Optional normalized OEM code.</summary>
    [FromQuery(Name = "manufacturer")]
    public string? Manufacturer { get; init; }

    /// <summary>Optional vehicle class.</summary>
    [FromQuery(Name = "vehicleClass")]
    [EnumDataType(typeof(Domain.Scheduling.VehicleClass))]
    public string? VehicleClass { get; init; }

    /// <summary>Optional explicit live HV work (<c>true</c> or <c>false</c>), so availability matches booking's flag.</summary>
    [FromQuery(Name = "needsLiveDiagnosis")]
    [DataType(SchedulerOpenApi.BooleanDataType)]
    public string? NeedsLiveDiagnosis { get; init; }

    /// <summary><see cref="Powertrain"/> as exactly one member name, or null when it is missing or anything else.</summary>
    public Domain.Scheduling.Powertrain? PowertrainValue =>
        ExactEnumName.TryParse<Domain.Scheduling.Powertrain>(Powertrain, out var value) ? value : null;

    /// <summary><see cref="VehicleClass"/> as exactly one member name, or null when it is missing or anything else.</summary>
    public Domain.Scheduling.VehicleClass? VehicleClassValue =>
        ExactEnumName.TryParse<Domain.Scheduling.VehicleClass>(VehicleClass, out var value) ? value : null;

    /// <summary><see cref="NeedsLiveDiagnosis"/> as a boolean, or null when it is missing or not <c>true</c>/<c>false</c>.</summary>
    public bool? LiveDiagnosis => bool.TryParse(NeedsLiveDiagnosis, out var value) ? value : null;

    /// <summary><see cref="Date"/> parsed strictly as <see cref="DateFormat"/>, or null when it is missing or in any other form.</summary>
    public DateOnly? LocalDate =>
        DateOnly.TryParseExact(Date, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}

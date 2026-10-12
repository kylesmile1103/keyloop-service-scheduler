using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
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

    // The vehicle-aware parameters bind as text too, for the same reason: the validator accepts exactly one enum member name (a comma
    // list or a repeated parameter, which binds joined by commas, would otherwise be ORed into another member) and a boolean, and
    // rejects anything else as a field error. A nullable bool would bind a malformed value as null and end in the framework's bare
    // 400. [EnumDataType] and [DataType("boolean")] only document the contract (SchedulerOpenApi.TransformParameterSchema).

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

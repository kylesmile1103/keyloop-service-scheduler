namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>Stable lowercase-kebab resource tokens included in <c>not-found</c> and <c>slot-conflict</c> problem extensions.</summary>
public static class ProblemResources
{
    public const string Dealership = "dealership";
    public const string ServiceType = "service-type";
    public const string Appointment = "appointment";
    public const string Bay = "bay";
    public const string Technician = "technician";

    /// <summary>Fallback <c>conflictingResource</c> value when no specific constraint name is available.</summary>
    public const string Unknown = "unknown";
}

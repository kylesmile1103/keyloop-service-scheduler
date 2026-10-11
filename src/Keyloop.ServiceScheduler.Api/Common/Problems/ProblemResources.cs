namespace Keyloop.ServiceScheduler.Api.Common.Problems;

/// <summary>
/// The resource tokens problems carry (SYSTEM_DESIGN §8.7): <c>resource</c> on <c>not-found</c> and <c>conflictingResource</c> on
/// <c>slot-conflict</c>. Lowercase kebab case; clients branch on them, so they are stable API.
/// </summary>
public static class ProblemResources
{
    public const string Dealership = "dealership";
    public const string ServiceType = "service-type";
    public const string Appointment = "appointment";
    public const string Bay = "bay";
    public const string Technician = "technician";
}

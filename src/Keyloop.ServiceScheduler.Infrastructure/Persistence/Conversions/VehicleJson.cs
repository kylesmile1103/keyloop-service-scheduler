using System.Text.Json;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Serialization;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Conversions;

internal static class VehicleJson
{
    public static string RequirementsToJson(RecordedRequirements value) => JsonSerializer.Serialize(value, PersistenceJsonContext.Default.RecordedRequirements);
    public static RecordedRequirements RequirementsFromJson(string value) => JsonSerializer.Deserialize(value, PersistenceJsonContext.Default.RecordedRequirements)
        ?? throw new InvalidOperationException("Recorded requirements cannot be JSON null.");
    public static string ProvenanceToJson(ProfileProvenance value) => JsonSerializer.Serialize(value, PersistenceJsonContext.Default.ProfileProvenance);
    public static ProfileProvenance ProvenanceFromJson(string value) => JsonSerializer.Deserialize(value, PersistenceJsonContext.Default.ProfileProvenance)
        ?? throw new InvalidOperationException("Profile provenance cannot be JSON null.");
    public static string DecisionToJson(AllocationDecision value) => JsonSerializer.Serialize(value, PersistenceJsonContext.Default.AllocationDecision);
    public static AllocationDecision DecisionFromJson(string value) => JsonSerializer.Deserialize(value, PersistenceJsonContext.Default.AllocationDecision)
        ?? throw new InvalidOperationException("Allocation decision cannot be JSON null.");
}

using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

internal static partial class SchedulerLog
{
    /// <summary>Bounded query kind and result count only; never search input or returned personal data.</summary>
    [LoggerMessage(EventId = 1500, EventName = "CustomerLookupCompleted", Level = LogLevel.Information,
        Message = "Customer lookup completed: kind {QueryKind}, results {ResultCount}")]
    public static partial void CustomerLookupCompleted(ILogger logger, CustomerLookupKind queryKind, int resultCount);
}

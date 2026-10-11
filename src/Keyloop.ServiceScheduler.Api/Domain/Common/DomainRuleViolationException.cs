namespace Keyloop.ServiceScheduler.Api.Domain.Common;

/// <summary>Maps to 422. <see cref="RuleCode"/> is the problem slug (e.g. "outside-operating-hours").</summary>
public sealed class DomainRuleViolationException(string ruleCode, string detail, IReadOnlyDictionary<string, object?>? extensions = null)
    : DomainException(detail)
{
    public string RuleCode { get; } = ruleCode;

    public IReadOnlyDictionary<string, object?> Extensions { get; } = extensions ?? new Dictionary<string, object?>();
}

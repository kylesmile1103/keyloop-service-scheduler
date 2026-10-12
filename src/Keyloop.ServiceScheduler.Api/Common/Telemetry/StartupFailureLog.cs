using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>
/// Records why the composition root's early configuration check failed (<c>Program.cs</c>), so the crash leaves a structured
/// Critical record under JSON and OTLP logging: 1103 <c>StartupValidationFailed</c> per failing options type, and 1104
/// <c>StartupConfigurationFailed</c> for anything else, typically a value the configuration binder could not convert. No
/// configured value is logged; the exception itself is not attached, because its message and inner exceptions can repeat one.
/// </summary>
internal static partial class StartupFailureLog
{
    public static void Write(ILogger logger, Exception exception)
    {
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(exception);

        // The startup validator throws one OptionsValidationException, or an AggregateException of them when several types fail.
        IEnumerable<Exception> failures = exception is AggregateException aggregate ? aggregate.InnerExceptions : [exception];
        foreach (var failure in failures)
        {
            if (failure is OptionsValidationException validation)
            {
                logger.StartupValidationFailed(validation.OptionsType.Name, string.Join("; ", validation.Failures));
            }
            else
            {
                logger.StartupConfigurationFailed(failure.GetType().FullName ?? failure.GetType().Name, SafeDetail(failure.Message));
            }
        }
    }

    // Only the exact binder conversion diagnostic is recognised. Arbitrary messages, including text before/after a binder-like
    // substring, may contain secrets. Never pass them or an exception object to a logging provider.
    private static string SafeDetail(string message)
    {
        var match = BinderConversionFailure().Match(message);
        return match.Success
            ? $"Failed to convert the configuration value at '{match.Groups["path"].Value}' to type '{match.Groups["type"].Value}'."
            : "Configuration loading failed; check the deployment settings.";
    }

    [GeneratedRegex(@"\AFailed to convert configuration value '.*' at '(?<path>[A-Za-z0-9_:.-]+)' to type '(?<type>[A-Za-z0-9_.]+)'\.\z", RegexOptions.Singleline | RegexOptions.CultureInvariant)]
    private static partial Regex BinderConversionFailure();
}

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
                logger.StartupConfigurationFailed(failure.GetType().FullName ?? failure.GetType().Name, WithoutValues(failure.Message));
            }
        }
    }

    // The binder quotes the value it could not convert, which could be a secret put in the wrong setting; only the path and the
    // target type are kept. The match is greedy, so a value that itself contains "' at '" is still removed whole.
    private static string WithoutValues(string message) =>
        BinderConversionFailure().Replace(message, "Failed to convert the configuration value at '${path}' to type '${type}'.");

    [GeneratedRegex(@"Failed to convert configuration value '.*' at '(?<path>[^']*)' to type '(?<type>[^']*)'\.", RegexOptions.Singleline | RegexOptions.CultureInvariant)]
    private static partial Regex BinderConversionFailure();
}

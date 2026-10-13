using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Telemetry;

/// <summary>Logs structured Critical records for startup options validation or configuration binding failures without exposing secrets.</summary>
internal static partial class StartupFailureLog
{
    public static void Write(ILogger logger, Exception exception)
    {
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(exception);

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

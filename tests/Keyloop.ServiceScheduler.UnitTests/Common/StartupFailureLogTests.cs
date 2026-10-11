using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

/// <summary>The structured record of an early startup failure (Program.cs); the composition-root wiring is covered by the integration suite.</summary>
public class StartupFailureLogTests
{
    [Fact]
    public void Validation_failures_are_logged_as_critical_1103_once_per_options_type()
    {
        var logger = new CapturingLogger<StartupFailureLogTests>();
        var failure = new AggregateException(
            new OptionsValidationException("", typeof(SchedulingOptions), ["SlotGranularityMinutes: The field SchedulingOptions.SlotGranularityMinutes must be between 5 and 60."]),
            new OptionsValidationException("", typeof(SecurityOptions), ["AllowedOrigins: entry is not an exact origin.", "GlobalPermitsPerMinute: out of range."]));

        StartupFailureLog.Write(logger, failure);

        logger.Entries.Select(e => (e.EventId, e.Level)).ShouldBe(
            [(new EventId(1103, "StartupValidationFailed"), LogLevel.Critical), (new EventId(1103, "StartupValidationFailed"), LogLevel.Critical)]);
        logger.Entries[0].Message.ShouldBe(
            "Configuration validation failed for SchedulingOptions; the API will not start: SlotGranularityMinutes: The field SchedulingOptions.SlotGranularityMinutes must be between 5 and 60.");
        logger.Entries[1].Message.ShouldBe(
            "Configuration validation failed for SecurityOptions; the API will not start: AllowedOrigins: entry is not an exact origin.; GlobalPermitsPerMinute: out of range.");
    }

    [Fact]
    public void Any_other_failure_is_logged_as_critical_1104_with_type_and_message_but_not_the_unconvertible_value()
    {
        var logger = new CapturingLogger<StartupFailureLogTests>();
        // The configuration binder's own wording; the inner exception repeats the value and is not logged either.
        var failure = new InvalidOperationException(
            "Failed to convert configuration value 'Password=hunter2' at 'Scheduling:SlotGranularityMinutes' to type 'System.Int32'.",
            new FormatException("The input string 'Password=hunter2' was not in a correct format."));

        StartupFailureLog.Write(logger, failure);

        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.EventId.ShouldBe(new EventId(1104, "StartupConfigurationFailed"));
        entry.Level.ShouldBe(LogLevel.Critical);
        entry.Message.ShouldBe(
            "Configuration could not be loaded; the API will not start: System.InvalidOperationException: Failed to convert the configuration value at 'Scheduling:SlotGranularityMinutes' to type 'System.Int32'.");
        entry.Exception.ShouldBeNull();
    }

    [Fact]
    public void A_message_that_carries_no_value_is_logged_as_it_is()
    {
        var logger = new CapturingLogger<StartupFailureLogTests>();

        StartupFailureLog.Write(logger, new InvalidOperationException("Connection string 'schedulerdb' is missing."));

        logger.Entries.ShouldHaveSingleItem().Message.ShouldEndWith("System.InvalidOperationException: Connection string 'schedulerdb' is missing.");
    }
}

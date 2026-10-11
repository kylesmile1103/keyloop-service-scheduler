using Keyloop.ServiceScheduler.Api.Common.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

// The validators are produced by the [OptionsValidator] source generator from the options' [Range] attributes (Addendum A §A4).
public class OptionsValidatorTests
{
    [Fact]
    public void Defaults_are_valid()
    {
        new SchedulingOptionsValidator().Validate(null, new SchedulingOptions()).Succeeded.ShouldBeTrue();
        new SecurityOptionsValidator().Validate(null, new SecurityOptions()).Succeeded.ShouldBeTrue();
    }

    [Theory]
    [InlineData(4)]
    [InlineData(61)]
    public void Slot_granularity_must_be_5_to_60_minutes(int minutes) =>
        Failure(new SchedulingOptions { SlotGranularityMinutes = minutes }).ShouldContain(nameof(SchedulingOptions.SlotGranularityMinutes));

    [Theory]
    [InlineData(0)]
    [InlineData(366)]
    public void Booking_horizon_must_be_1_to_365_days(int days) =>
        Failure(new SchedulingOptions { BookingHorizonDays = days }).ShouldContain(nameof(SchedulingOptions.BookingHorizonDays));

    [Theory]
    [InlineData(-1)]
    [InlineData(11)]
    public void Suggested_slot_count_must_be_0_to_10(int count) =>
        Failure(new SchedulingOptions { SuggestedSlotCount = count }).ShouldContain(nameof(SchedulingOptions.SuggestedSlotCount));

    [Fact]
    public void Minimum_lead_time_cannot_be_negative() =>
        Failure(new SchedulingOptions { MinimumLeadTime = TimeSpan.FromMinutes(-1) }).ShouldContain(nameof(SchedulingOptions.MinimumLeadTime));

    [Fact]
    public void Minimum_lead_time_must_be_shorter_than_the_booking_horizon() =>
        // BookingWindowPolicy would otherwise throw on the first request instead of at startup.
        Failure(new SchedulingOptions { BookingHorizonDays = 1, MinimumLeadTime = TimeSpan.FromDays(1) }).ShouldContain(nameof(SchedulingOptions.MinimumLeadTime));

    [Theory]
    [InlineData(0, 30)]
    [InlineData(300, 0)]
    public void Rate_limit_permits_must_be_positive(int global, int booking)
    {
        var options = new SecurityOptions { RateLimiting = new() { GlobalPermitsPerMinute = global, BookingPermitsPerMinute = booking } };

        var result = new SecurityOptionsValidator().Validate(null, options);

        result.Failed.ShouldBeTrue();
        result.FailureMessage.ShouldContain("PermitsPerMinute");
    }

    [Fact]
    public void Binding_an_invalid_value_from_configuration_fails_validation()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Scheduling:SlotGranularityMinutes"] = "90" }).Build();
        using var services = new ServiceCollection()
            .AddSingleton<IConfiguration>(configuration)
            .AddSingleton<IValidateOptions<SchedulingOptions>, SchedulingOptionsValidator>()
            .AddOptions<SchedulingOptions>().BindConfiguration(SchedulingOptions.SectionName).Services
            .BuildServiceProvider();

        var ex = Should.Throw<OptionsValidationException>(() => services.GetRequiredService<IOptions<SchedulingOptions>>().Value);

        ex.Message.ShouldContain(nameof(SchedulingOptions.SlotGranularityMinutes));
    }

    private static string Failure(SchedulingOptions options)
    {
        var result = new SchedulingOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        return result.FailureMessage;
    }
}

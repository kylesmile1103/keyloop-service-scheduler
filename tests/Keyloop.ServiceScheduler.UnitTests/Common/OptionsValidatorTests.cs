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

    [Theory]
    [InlineData("*")]
    [InlineData("localhost:5173")]
    [InlineData("ftp://board.example")]
    [InlineData("https://board.example/path")]
    public void Allowed_origins_must_be_exact_http_origins(string origin) =>
        SecurityFailure(new SecurityOptions { AllowedOrigins = ["https://board.example", origin] }).ShouldContain(nameof(SecurityOptions.AllowedOrigins));

    [Fact]
    public void Exact_origins_are_valid() =>
        new SecurityOptionsValidator().Validate(null, new SecurityOptions { AllowedOrigins = ["https://board.example", "http://localhost:5173"] })
            .Succeeded.ShouldBeTrue();

    [Theory]
    [InlineData("not-an-ip", null)]
    [InlineData(null, "10.0.0.0/33")]
    [InlineData(null, "10.0.0.0")]
    public void Known_proxies_and_networks_must_parse(string? proxy, string? network)
    {
        var forwarded = new SecurityOptions.ForwardedHeadersSettings
        {
            KnownProxies = proxy is null ? [] : [proxy],
            KnownNetworks = network is null ? [] : [network],
        };

        SecurityFailure(new SecurityOptions { ForwardedHeaders = forwarded }).ShouldContain(proxy is null ? "KnownNetworks" : "KnownProxies");
    }

    [Fact]
    public void Enabled_forwarded_headers_need_a_trusted_proxy_or_network() =>
        // With both lists empty the framework trusts X-Forwarded-For from any peer, so anyone could pick their rate-limit partition.
        SecurityFailure(new SecurityOptions { ForwardedHeaders = new() { Enabled = true } }).ShouldContain("ForwardedHeaders");

    [Fact]
    public void Enabled_forwarded_headers_with_trusted_addresses_are_valid() =>
        new SecurityOptionsValidator().Validate(null, new SecurityOptions
        {
            ForwardedHeaders = new() { Enabled = true, KnownProxies = ["10.1.2.3", "::1"], KnownNetworks = ["10.0.0.0/8", "fd00::/8"] },
        }).Succeeded.ShouldBeTrue();

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

    private static string SecurityFailure(SecurityOptions options)
    {
        var result = new SecurityOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        return result.FailureMessage;
    }

    private static string Failure(SchedulingOptions options)
    {
        var result = new SchedulingOptionsValidator().Validate(null, options);
        result.Failed.ShouldBeTrue();
        return result.FailureMessage;
    }
}

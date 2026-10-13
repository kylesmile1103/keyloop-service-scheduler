using Keyloop.ServiceScheduler.Api.Common.Options;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public sealed class HttpsRedirectionOptionsTests
{
    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(65536)]
    public void Enabled_redirection_requires_a_valid_destination_port(int? port)
    {
        var result = new SecurityOptionsValidator().Validate(null, new SecurityOptions
        {
            HttpsRedirection = new() { Enabled = true, HttpsPort = port },
        });
        result.Failed.ShouldBeTrue();
        result.FailureMessage.ShouldContain("HttpsPort");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(443)]
    [InlineData(7180)]
    [InlineData(65535)]
    public void Enabled_redirection_accepts_valid_destination_ports(int port) =>
        new SecurityOptionsValidator().Validate(null, new SecurityOptions
        {
            HttpsRedirection = new() { Enabled = true, HttpsPort = port },
        }).Succeeded.ShouldBeTrue();
}

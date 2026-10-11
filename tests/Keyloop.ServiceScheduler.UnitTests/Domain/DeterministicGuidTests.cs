using Keyloop.ServiceScheduler.Api.Domain.Common;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class DeterministicGuidTests
{
    [Fact]
    public void Same_name_same_guid() =>
        DeterministicGuid.Create("bay-1").ShouldBe(DeterministicGuid.Create("bay-1"));

    [Fact]
    public void Different_names_differ() =>
        DeterministicGuid.Create("bay-1").ShouldNotBe(DeterministicGuid.Create("bay-2"));

    [Fact]
    public void Has_version_8_and_rfc_variant()
    {
        var text = DeterministicGuid.Create("bay-1").ToString();
        text[14].ShouldBe('8');
        "89ab".ShouldContain(text[19]);
    }
}

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

    [Fact]
    public void Pinned_vector_for_reading_dealership_is_stable() =>
        DeterministicGuid.Create("dealership:reading").ShouldBe(Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e"));
}

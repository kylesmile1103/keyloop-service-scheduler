using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class VehicleDetailsTests
{
    private static readonly Vin TestVin = Vin.Create("WVWZZZ1KZAW123456");

    [Fact]
    public void Registration_is_uppercased() =>
        new VehicleDetails(TestVin, " ab12 cde ", "VW", "Golf").Registration.ShouldBe("AB12 CDE");

    [Fact]
    public void Rejects_empty_make() =>
        Should.Throw<ArgumentException>(() => new VehicleDetails(TestVin, "AB1", "", "Golf")).ParamName.ShouldBe("make");

    [Fact]
    public void Rejects_61_char_model() =>
        Should.Throw<ArgumentException>(() => new VehicleDetails(TestVin, "AB1", "VW", new string('a', 61)));
}

using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class VinTests
{
    [Fact]
    public void Valid_vin_is_normalised_to_uppercase()
    {
        Vin.TryCreate(" wvwzzz1kzaw123456 ", out var vin).ShouldBeTrue();
        vin.Value.ShouldBe("WVWZZZ1KZAW123456");
        Vin.Create(" wvwzzz1kzaw123456 ").Value.ShouldBe("WVWZZZ1KZAW123456");
    }

    [Fact]
    public void Rejects_16_characters()
    {
        Vin.TryCreate("WVWZZZ1KZAW12345", out _).ShouldBeFalse();
        Should.Throw<ArgumentException>(() => Vin.Create("WVWZZZ1KZAW12345")).Message.ShouldStartWith("Invalid VIN");
    }

    [Theory]
    [InlineData("IVWZZZ1KZAW123456")]
    [InlineData("WVWZZZ1KZOW123456")]
    [InlineData("WVWZZZ1KZAW12345Q")]
    public void Rejects_letters_I_O_Q(string raw)
    {
        Vin.TryCreate(raw, out _).ShouldBeFalse();
    }

    [Fact]
    public void Rejects_null()
    {
        Vin.TryCreate(null, out _).ShouldBeFalse();
    }

    [Fact]
    public void Masked_shows_last_six()
    {
        Vin.Create("WVWZZZ1KZAW123456").Masked.ShouldBe("***********123456");
    }

    [Fact]
    public void Rejects_18_characters() => Vin.TryCreate("WVWZZZ1KZAW1234567", out _).ShouldBeFalse();

    [Fact]
    public void ToString_prints_masked_vin()
    {
        var vin = Vin.Create("WVWZZZ1KZAW123456");
        vin.ToString().ShouldBe("***********123456");
    }

    [Fact]
    public void Vehicle_ToString_masks_both_the_VIN_and_the_whole_registration()
    {
        // Nothing logs a vehicle today; if anything ever formats one (a log, an exception, a record's generated ToString), no plate
        // character or length escapes, matching the anonymous reads' registration mask.
        var vehicle = new VehicleDetails(Vin.Create("WVWZZZ1KZAW123456"), "ab12 cde", "VW", "Golf");

        vehicle.ToString().ShouldBe("***********123456 ******* VW Golf");
        vehicle.ToString().ShouldNotContain("CDE");
        VehicleDetails.MaskedRegistration.ShouldBe("*******");
        new VehicleDetails(Vin.Create("WVWZZZ1KZAW123456"), "K1 NGS", "VW", "Golf").ToString().ShouldBe("***********123456 ******* VW Golf");
    }
}

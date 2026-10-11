using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class CustomerDetailsTests
{
    [Fact]
    public void Trims_values()
    {
        var c = new CustomerDetails("  Ann  ", " a@b.c ", " 0123 ");
        (c.Name, c.Email, c.Phone).ShouldBe(("Ann", "a@b.c", "0123"));
    }

    [Fact]
    public void Rejects_empty_name() =>
        Should.Throw<ArgumentException>(() => new CustomerDetails("  ", "a@b.c", "0123")).ParamName.ShouldBe("name");

    [Fact]
    public void Rejects_121_char_name() =>
        Should.Throw<ArgumentException>(() => new CustomerDetails(new string('a', 121), "a@b.c", "0123"));

    [Fact]
    public void Rejects_2_char_phone() =>
        Should.Throw<ArgumentException>(() => new CustomerDetails("Ann", "a@b.c", "12")).ParamName.ShouldBe("phone");

    [Fact]
    public void Rejects_255_char_email() =>
        Should.Throw<ArgumentException>(() => new CustomerDetails("Ann", new string('a', 255), "0123"));
}

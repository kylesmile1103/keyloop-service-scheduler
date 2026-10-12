using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class TriageImagesTests
{
    private const string Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=";

    [Fact]
    public void Decodes_a_png_and_rejects_a_mismatched_type()
    {
        var bytes = TriageImageValidator.Decode("image/png", Png);
        bytes.ShouldBe(Convert.FromBase64String(Png));
        Should.Throw<TriageInputException>(() => TriageImageValidator.Decode("image/jpeg", Png)).Field.ShouldBe("base64");
    }

    [Theory]
    [InlineData("application/pdf", "private-file")]
    [InlineData("image/png", "private-file")]
    [InlineData("image/png", "")]
    public void Rejects_unsupported_or_invalid_media_without_echoing_it(string type, string data)
    {
        var error = Should.Throw<TriageInputException>(() => TriageImageValidator.Decode(type, data));
        error.ToString().ShouldNotContain("private-file");
    }

    [Fact]
    public void Bounds_pixel_count_without_integer_overflow()
    {
        var bytes = Convert.FromBase64String(Png);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(16), uint.MaxValue);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20), uint.MaxValue);
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/png", bytes));
    }

    [Fact]
    public void Bounds_the_actual_decoded_byte_count()
    {
        var bytes = new byte[TriageImageLimits.MaxImageBytes + 1];
        Convert.FromBase64String(Png).CopyTo(bytes, 0);
        Should.Throw<TriageInputException>(() => TriageImageValidator.Decode("image/png", Convert.ToBase64String(bytes)));
    }

    [Fact]
    public void Native_payload_preserves_base64_characters_and_stays_within_the_media_body_limit()
    {
        var bytes = Enumerable.Repeat((byte)251, TriageImageLimits.MaxImageBytes).ToArray();
        var encoded = Convert.ToBase64String(bytes);
        encoded.ShouldContain("+");
        var request = new ClefRequest("clef-flash", new("customer <text> with quotes: \""), new()
        {
            ["service"] = new("choice", new JsonObject { ["question"] = "Choose a service" }, new JsonObject { ["A"] = "a", ["B"] = "b" }),
        }, [new("image/png", encoded), new("image/png", encoded)]);
        var json = JsonSerializer.SerializeToUtf8Bytes(request, TriageJsonContext.Transport.ClefRequest);
        json.Length.ShouldBeLessThan(13 * 1024 * 1024);
        using var document = JsonDocument.Parse(json);
        document.RootElement.GetProperty("images")[0].GetProperty("content_type").GetString().ShouldBe("image/png");
        document.RootElement.GetProperty("images")[0].GetProperty("base64").GetString().ShouldBe(encoded);
        document.RootElement.GetProperty("state").GetProperty("customer_description").GetString().ShouldBe(request.State.CustomerDescription);
    }

    [Fact]
    public void Local_uploads_are_scoped_to_dealership_and_expire_at_the_boundary()
    {
        var clock = new FakeTimeProvider();
        var store = new TransientTriageImages(clock);
        var dealership = Guid.NewGuid();
        var id = Guid.NewGuid();
        var image = new StoredTriageImage("image/png", Convert.FromBase64String(Png), clock.GetUtcNow().AddHours(1));
        store.Put(dealership, id, image);
        store.Get(dealership, id).ShouldBe(image);
        store.Get(Guid.NewGuid(), id).ShouldBeNull();
        clock.Advance(TimeSpan.FromHours(1));
        store.Get(dealership, id).ShouldBeNull();
    }
}

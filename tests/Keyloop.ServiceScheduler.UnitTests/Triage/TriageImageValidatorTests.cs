using System.Buffers.Binary;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

/// <summary>
/// Verifies image format signature and dimension validation against real JPEG, PNG, and WebP fixtures.
/// </summary>
public sealed class TriageImageValidatorTests
{
    private static byte[] Fixture(string name) => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Triage", "Fixtures", name));

    [Theory]
    [InlineData("baseline-3x2.jpg", "image/jpeg")]     // SOF0, with APP1 Exif and APP13 before the frame header
    [InlineData("progressive-3x2.jpg", "image/jpeg")]  // SOF2
    [InlineData("plain-3x2.png", "image/png")]
    [InlineData("lossy-vp8-3x2.webp", "image/webp")]   // simple lossy
    [InlineData("lossless-vp8l-3x2.webp", "image/webp")]
    [InlineData("alpha-vp8x-3x2.webp", "image/webp")]  // extended: VP8X canvas, ALPH and VP8 chunks
    public void Reads_real_encoder_output_as_width_then_height_and_accepts_it(string name, string type)
    {
        var bytes = Fixture(name);
        TriageImageValidator.Dimensions(type, bytes).ShouldBe((3L, 2L));
        Should.NotThrow(() => TriageImageValidator.Validate(type, bytes));
    }

    [Theory]
    [InlineData("plain-3x2.png", "image/webp")]
    [InlineData("baseline-3x2.jpg", "image/webp")]
    [InlineData("lossy-vp8-3x2.webp", "image/png")]
    [InlineData("lossy-vp8-3x2.webp", "image/jpeg")]
    [InlineData("baseline-3x2.jpg", "image/png")]
    public void Rejects_a_real_image_labelled_as_another_type(string name, string type) =>
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate(type, Fixture(name))).Field.ShouldBe("base64");

    [Fact]
    public void Rejects_a_png_labelled_body_with_an_IHDR_layout_but_no_png_signature()
    {
        var bytes = Fixture("plain-3x2.png");
        bytes.AsSpan(0, 8).Clear();
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/png", bytes));

        var zeros = new byte[64];
        BinaryPrimitives.WriteUInt32BigEndian(zeros.AsSpan(8), 13);
        "IHDR"u8.CopyTo(zeros.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(zeros.AsSpan(16), 3);
        BinaryPrimitives.WriteUInt32BigEndian(zeros.AsSpan(20), 2);
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/png", zeros));
    }

    [Fact]
    public void Rejects_animated_webp()
    {
        var bytes = Fixture("animated-vp8x-3x2.webp");
        "VP8X"u8.SequenceEqual(bytes.AsSpan(12, 4)).ShouldBeTrue();
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/webp", bytes));
    }

    [Theory]
    [InlineData("lossy-vp8-3x2.webp", 1)]
    [InlineData("lossless-vp8l-3x2.webp", -1)]
    [InlineData("alpha-vp8x-3x2.webp", 2)]
    public void Rejects_webp_whose_RIFF_size_disagrees_with_the_bytes(string name, int delta)
    {
        var bytes = Fixture(name);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)(BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4)) + delta));
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/webp", bytes));
    }

    [Theory]
    [InlineData(4000, 4000, true)]  // exactly 16 million pixels
    [InlineData(4001, 4000, false)]
    [InlineData(16384, 1, true)]
    [InlineData(16777216, 16777216, false)]  // the largest VP8X canvas, without overflow
    public void Bounds_the_VP8X_canvas_at_16_megapixels(int width, int height, bool accepted)
    {
        var bytes = Fixture("alpha-vp8x-3x2.webp");
        WriteUInt24(bytes.AsSpan(24), width - 1);
        WriteUInt24(bytes.AsSpan(27), height - 1);
        TriageImageValidator.Dimensions("image/webp", bytes).ShouldBe(((long)width, (long)height));
        if (accepted) { Should.NotThrow(() => TriageImageValidator.Validate("image/webp", bytes)); }
        else { Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/webp", bytes)); }
    }

    [Theory]
    [InlineData("baseline-3x2.jpg")]
    [InlineData("progressive-3x2.jpg")]
    public void Accepts_jpeg_with_a_trailer_after_the_end_of_image_marker(string name)
    {
        // Samsung SEFT trailers and Google/Samsung Motion Photo videos follow the EOI marker of an ordinary JPEG.
        var bytes = Fixture(name).Concat("SEFT trailer"u8.ToArray()).ToArray();
        TriageImageValidator.Dimensions("image/jpeg", bytes).ShouldBe((3L, 2L));
        Should.NotThrow(() => TriageImageValidator.Validate("image/jpeg", bytes));
    }

    [Fact]
    public void Rejects_jpeg_without_a_start_of_image_marker_or_frame_header()
    {
        var bytes = Fixture("baseline-3x2.jpg");
        var noSoi = bytes.ToArray();
        noSoi[1] = 0;
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/jpeg", noSoi));
        // Cut inside the APP13 segment: the frame header never arrives.
        Should.Throw<TriageInputException>(() => TriageImageValidator.Validate("image/jpeg", bytes.AsSpan(0, 120)));
    }

    private static void WriteUInt24(Span<byte> target, int value)
    {
        target[0] = (byte)value;
        target[1] = (byte)(value >> 8);
        target[2] = (byte)(value >> 16);
    }
}

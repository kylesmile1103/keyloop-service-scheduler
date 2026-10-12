using System.Buffers.Binary;

namespace Keyloop.ServiceScheduler.Infrastructure.Triage;

/// <summary>Bounds encoded bytes and image dimensions before storage or inference. Does not decode pixel buffers.</summary>
public static class TriageImageValidator
{
    public static byte[] Decode(string contentType, string base64)
    {
        if (contentType is not ("image/png" or "image/jpeg" or "image/webp"))
        {
            throw new TriageInputException("contentType", "Choose a PNG, JPEG or WebP image.");
        }
        if (string.IsNullOrEmpty(base64) || base64.Length > 4 * ((TriageImageLimits.MaxImageBytes + 2) / 3))
        {
            throw new TriageInputException("base64", "Each image must contain 1 byte to 4 MiB.");
        }
        byte[] bytes;
        try { bytes = Convert.FromBase64String(base64); }
        catch (FormatException) { throw new TriageInputException("base64", "The image must be valid base64."); }
        Validate(contentType, bytes);
        return bytes;
    }

    public static void Validate(string contentType, ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length is 0 or > TriageImageLimits.MaxImageBytes)
        {
            throw new TriageInputException("base64", "Each image must contain 1 byte to 4 MiB.");
        }
        var (width, height) = Dimensions(contentType, bytes);
        if (width <= 0 || height <= 0 || width > TriageImageLimits.MaxPixels / height)
        {
            throw new TriageInputException("base64", "The file must match its image type and contain at most 16 megapixels.");
        }
    }

    /// <summary>Header dimensions when the bytes carry the claimed type's signature; (0, 0) otherwise.</summary>
    internal static (long Width, long Height) Dimensions(string contentType, ReadOnlySpan<byte> bytes) => contentType switch
    {
        "image/png" => Png(bytes),
        "image/jpeg" => Jpeg(bytes),
        "image/webp" => Webp(bytes),
        _ => (0L, 0L),
    };

    private static (long, long) Png(ReadOnlySpan<byte> b) =>
        b.Length >= 33 && b[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) &&
        BinaryPrimitives.ReadUInt32BigEndian(b[8..]) == 13 && b.Slice(12, 4).SequenceEqual("IHDR"u8)
            ? (BinaryPrimitives.ReadUInt32BigEndian(b[16..]), BinaryPrimitives.ReadUInt32BigEndian(b[20..])) : (0, 0);

    private static (long, long) Jpeg(ReadOnlySpan<byte> b)
    {
        // No end-of-image check: phone formats (Samsung SEFT, Motion Photo video) append data after EOI. The walk below already
        // requires SOI and a well-formed segment chain up to a frame header that bounds the dimensions.
        if (b.Length < 4 || b[0] != 255 || b[1] != 216)
        {
            return (0, 0);
        }

        for (var i = 2; i + 3 < b.Length;)
        {
            if (b[i++] != 255)
            {
                return (0, 0);
            }

            while (i < b.Length && b[i] == 255)
            {
                i++;
            }

            if (i >= b.Length)
            {
                return (0, 0);
            }

            var marker = b[i++];
            if (marker == 218 || marker == 217)
            {
                return (0, 0);
            }

            if (marker == 1 || marker is >= 208 and <= 215)
            {
                continue;
            }

            if (i + 2 > b.Length)
            {
                return (0, 0);
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(b[i..]);
            if (length < 2 || i + length > b.Length)
            {
                return (0, 0);
            }

            if (marker is 192 or 193 or 194 or 195 or 197 or 198 or 199 or 201 or 202 or 203 or 205 or 206 or 207)
            {
                return length >= 8 ? (BinaryPrimitives.ReadUInt16BigEndian(b[(i + 5)..]),
                    BinaryPrimitives.ReadUInt16BigEndian(b[(i + 3)..])) : (0, 0);
            }
            i += length;
        }
        return (0, 0);
    }

    private static (long, long) Webp(ReadOnlySpan<byte> b)
    {
        if (b.Length < 30 || !b[..4].SequenceEqual("RIFF"u8) || !b.Slice(8, 4).SequenceEqual("WEBP"u8) ||
            BinaryPrimitives.ReadUInt32LittleEndian(b[4..]) != b.Length - 8)
        {
            return (0, 0);
        }

        if (b.Slice(12, 4).SequenceEqual("VP8X"u8))
        {
            // Animated images are deliberately excluded from single-photo intake.
            if ((b[20] & 2) != 0)
            {
                return (0, 0);
            }

            return (1 + b[24] + (b[25] << 8) + (b[26] << 16), 1 + b[27] + (b[28] << 8) + (b[29] << 16));
        }
        if (b.Slice(12, 4).SequenceEqual("VP8 "u8) && b.Slice(23, 3).SequenceEqual(new byte[] { 157, 1, 42 }))
        {
            return (BinaryPrimitives.ReadUInt16LittleEndian(b[26..]) & 16383, BinaryPrimitives.ReadUInt16LittleEndian(b[28..]) & 16383);
        }

        if (b.Slice(12, 4).SequenceEqual("VP8L"u8) && b[20] == 47)
        {
            return (1 + b[21] + ((b[22] & 63) << 8), 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10));
        }

        return (0, 0);
    }
}

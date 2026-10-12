using System.Security.Cryptography;
using System.Text;

namespace Keyloop.ServiceScheduler.Domain.Common;

public static class DeterministicGuid
{
    public static Guid Create(string name)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("keyloop-scheduler:" + name));
        var bytes = hash.AsSpan(0, 16).ToArray();
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x80);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes);
    }
}

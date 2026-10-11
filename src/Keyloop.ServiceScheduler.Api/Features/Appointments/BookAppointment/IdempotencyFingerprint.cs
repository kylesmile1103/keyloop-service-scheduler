using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// What an <c>Idempotency-Key</c> was first used for (SYSTEM_DESIGN §7.5): the lower-case hex SHA-256 of the dealership id, a line
/// feed, and the request re-serialised through <see cref="SchedulerJsonContext"/> (fixed property order, no whitespace), so the same
/// request gives the same fingerprint however the client formatted its JSON. A key arriving with another fingerprint is a 422
/// <c>idempotency-key-reuse</c>.
/// </summary>
public static class IdempotencyFingerprint
{
    public static string Compute(Guid dealershipId, BookAppointmentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var json = JsonSerializer.Serialize(request, SchedulerJsonContext.Default.BookAppointmentRequest);
        var bytes = Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{dealershipId:D}\n{json}"));
        return Convert.ToHexStringLower(SHA256.HashData(bytes));
    }
}

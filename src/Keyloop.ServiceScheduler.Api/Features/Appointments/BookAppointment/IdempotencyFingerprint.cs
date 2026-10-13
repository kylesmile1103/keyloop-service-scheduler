using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

/// <summary>
/// Computes a canonical SHA-256 fingerprint of a booking request and dealership ID for idempotency verification.
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

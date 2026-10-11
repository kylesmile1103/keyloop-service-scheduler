using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The <c>Idempotency-Key</c> header's shape and the request fingerprint stored with a memoised booking (SYSTEM_DESIGN §7.5): same
/// dealership and same body give the same fingerprint (a replay), anything else a different one (422 <c>idempotency-key-reuse</c>).
/// </summary>
public class IdempotencyFingerprintTests
{
    private static readonly Guid Reading = Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e");

    private static readonly BookAppointmentRequest Request = new(
        Guid.Parse("3153f30d-5700-8f07-a25d-4a4ea44dfeef"),
        new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc),
        new CustomerRequest("Alex Morgan", "alex.morgan@example.com", "+44 7700 900123"),
        new VehicleRequest("WVWZZZ1KZAW123456", "AB12 CDE", "Volkswagen", "Golf"),
        PreferredBayId: null,
        PreferredTechnicianId: null,
        Notes: null);

    [Fact]
    public void Is_the_lower_case_sha256_of_the_dealership_id_and_the_canonical_json_body()
    {
        var json = JsonSerializer.Serialize(Request, SchedulerJsonContext.Default.BookAppointmentRequest);
        var expected = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{Reading:D}\n{json}")));

        var fingerprint = IdempotencyFingerprint.Compute(Reading, Request);

        fingerprint.ShouldBe(expected);
        fingerprint.Length.ShouldBe(64); // fits idempotency_keys.request_fingerprint (varchar(64))
        fingerprint.ShouldMatch("^[0-9a-f]{64}$");
    }

    [Fact]
    public void Is_stable_for_an_equal_request() =>
        IdempotencyFingerprint.Compute(Reading, Request with { }).ShouldBe(IdempotencyFingerprint.Compute(Reading, Request));

    [Fact]
    public void Differs_by_dealership() =>
        IdempotencyFingerprint.Compute(Guid.NewGuid(), Request).ShouldNotBe(IdempotencyFingerprint.Compute(Reading, Request));

    public static TheoryData<string> Changes() => ["serviceTypeId", "startUtc", "customer.email", "vehicle.vin", "preferredBayId", "notes"];

    [Theory]
    [MemberData(nameof(Changes))]
    public void Differs_when_any_field_differs(string field)
    {
        var changed = field switch
        {
            "serviceTypeId" => Request with { ServiceTypeId = Guid.NewGuid() },
            "startUtc" => Request with { StartUtc = Request.StartUtc.AddMinutes(15) },
            "customer.email" => Request with { Customer = Request.Customer with { Email = "someone.else@example.com" } },
            "vehicle.vin" => Request with { Vehicle = Request.Vehicle with { Vin = "WVWZZZ1KZAW654321" } },
            "preferredBayId" => Request with { PreferredBayId = Guid.NewGuid() },
            "notes" => Request with { Notes = "Also check the wipers." },
            _ => throw new ArgumentOutOfRangeException(nameof(field)),
        };

        IdempotencyFingerprint.Compute(Reading, changed).ShouldNotBe(IdempotencyFingerprint.Compute(Reading, Request));
    }

    [Theory]
    [InlineData(null)] // no header: the booking is simply not memoised
    [InlineData("a")]
    [InlineData("3f2b8c1e-6d4a-4e8f-9b7c-2a1d5e6f7a8b")] // a UUID, the documented choice
    [InlineData("retry_ABC-123")]
    [InlineData("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")] // 64 characters
    public void Accepts_an_absent_header_or_1_to_64_url_safe_characters(string? key) => IdempotencyKeyHeader.Validate(key).ShouldBeNull();

    [Theory]
    [InlineData("")]
    [InlineData("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")] // 65 characters
    [InlineData("has space")]
    [InlineData("a,b")] // two header values arrive joined by a comma
    [InlineData("ключ")]
    [InlineData("key=1")]
    public void Rejects_any_other_key(string key) =>
        IdempotencyKeyHeader.Validate(key).ShouldBe("Idempotency-Key must be 1 to 64 characters: letters, digits, '-' and '_' (a UUID works).");

    [Fact]
    public void Header_names_are_the_documented_ones()
    {
        IdempotencyKeyHeader.Name.ShouldBe("Idempotency-Key");
        IdempotencyKeyHeader.ReplayedName.ShouldBe("Idempotent-Replayed");
    }
}

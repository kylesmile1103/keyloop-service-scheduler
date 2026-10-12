using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary><c>GET /api/v1/dealerships</c> over the reference catalogue (two dealerships).</summary>
public sealed class DealershipsEndpointTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));
        _client = _factory.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task GetDealerships_returns_seeded_dealerships_ordered_by_name()
    {
        using var response = await _client.GetAsync("/api/v1/dealerships", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var dealerships = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListDealershipResponse, Ct);
        dealerships.Select(d => (d.Id, d.Name, d.TimeZoneId)).ShouldBe(
        [
            (ReferenceDataSeed.MunichDealershipId, "Keyloop Autohaus München", "Europe/Berlin"),
            (ReferenceDataSeed.ReadingDealershipId, "Keyloop Motors Reading", "Europe/London"),
        ]);
    }

    [Fact]
    public async Task GetDealerships_lists_seven_days_from_Monday_with_HH_mm_times_and_closed_days_as_nulls()
    {
        using var response = await _client.GetAsync("/api/v1/dealerships", Ct);

        var dealerships = await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListDealershipResponse, Ct);
        var reading = dealerships.Single(d => d.Id == ReferenceDataSeed.ReadingDealershipId);
        reading.OperatingHours.ShouldBe(
        [
            new DayOperatingHoursResponse(DayOfWeek.Monday, "08:00", "18:00"),
            new DayOperatingHoursResponse(DayOfWeek.Tuesday, "08:00", "18:00"),
            new DayOperatingHoursResponse(DayOfWeek.Wednesday, "08:00", "18:00"),
            new DayOperatingHoursResponse(DayOfWeek.Thursday, "08:00", "18:00"),
            new DayOperatingHoursResponse(DayOfWeek.Friday, "08:00", "18:00"),
            new DayOperatingHoursResponse(DayOfWeek.Saturday, "08:00", "13:00"),
            new DayOperatingHoursResponse(DayOfWeek.Sunday, null, null),
        ]);

        // The wire format itself: day names rather than numbers, minutes kept, and closed days with explicit nulls (a typed read
        // accepts numeric enums and treats a missing member as null, so it cannot show this).
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var munich = body.RootElement.EnumerateArray().Single(d => d.GetProperty("id").GetGuid() == ReferenceDataSeed.MunichDealershipId);
        var days = munich.GetProperty("operatingHours").EnumerateArray().Select(day => day.GetRawText()).ToList();
        days[0].ShouldBe("""{"day":"Monday","opensAt":"07:30","closesAt":"18:30"}""");
        days[5].ShouldBe("""{"day":"Saturday","opensAt":null,"closesAt":null}""");
        days.Count.ShouldBe(7);
    }
}

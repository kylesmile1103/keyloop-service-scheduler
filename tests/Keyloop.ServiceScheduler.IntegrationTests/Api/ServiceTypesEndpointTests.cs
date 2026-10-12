using System.Net;
using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

/// <summary>
/// <c>GET /api/v1/dealerships/{dealershipId}/service-types</c>: the whole (global) catalogue, with <c>bookable</c> computed for the
/// route dealership from its active bays and technicians.
/// </summary>
public sealed class ServiceTypesEndpointTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private HttpClient _client = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        _client = _factory.CreateClient();
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task GetServiceTypes_marks_ev_service_not_bookable_when_no_ev_bay()
    {
        // The technician holds the high-voltage certification, so the only thing the EV service lacks here is a bay.
        var dealership = TestData.NewDealership("Standard Motors");
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "Bay 1", BayCapability.StandardLift),
            TestData.NewTechnician(dealership.Id, "Ben Okafor", "T-1002", Certification.GeneralService, Certification.HighVoltageElectrical),
            TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]),
            TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]));

        var serviceTypes = await GetServiceTypesAsync(dealership.Id);

        serviceTypes.Select(s => (s.Code, s.Bookable)).ShouldBe([("EV-BATTERY-CHECK", false), ("INTERIM-SERVICE", true)]);
    }

    [Fact]
    public async Task GetServiceTypes_ignores_an_inactive_ev_bay()
    {
        var dealership = TestData.NewDealership("Dormant EV Motors");
        await SaveAsync(
            dealership,
            ServiceBay.Create(Guid.NewGuid(), dealership.Id, "EV Bay", [BayCapability.EvHighVoltage], isActive: false),
            TestData.NewTechnician(dealership.Id, "Ben Okafor", "T-1002", Certification.HighVoltageElectrical),
            TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]));

        var serviceTypes = await GetServiceTypesAsync(dealership.Id);

        serviceTypes.ShouldHaveSingleItem().Bookable.ShouldBeFalse();
    }

    [Fact]
    public async Task GetServiceTypes_ignores_an_inactive_high_voltage_technician()
    {
        // The EV bay is active and the only high-voltage technician is not; the general technician shows resources are read at all.
        var dealership = TestData.NewDealership("Absent Specialist Motors");
        await SaveAsync(
            dealership,
            TestData.NewBay(dealership.Id, "EV Bay", BayCapability.EvHighVoltage, BayCapability.StandardLift),
            Technician.Create(
                Guid.NewGuid(), dealership.Id, "Ben Okafor", "T-1002", [Certification.HighVoltageElectrical, Certification.Diagnostics], isActive: false),
            TestData.NewTechnician(dealership.Id, "Amelia Clarke", "T-1001", Certification.GeneralService),
            TestData.NewServiceType("EV-BATTERY-CHECK", 60, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical]),
            TestData.NewServiceType("EV-CHARGING-FAULT", 90, [BayCapability.EvHighVoltage], [Certification.HighVoltageElectrical, Certification.Diagnostics]),
            TestData.NewServiceType("INTERIM-SERVICE", 60, [BayCapability.StandardLift], [Certification.GeneralService]));

        var serviceTypes = await GetServiceTypesAsync(dealership.Id);

        serviceTypes.Select(s => (s.Code, s.Bookable)).ShouldBe([("EV-BATTERY-CHECK", false), ("EV-CHARGING-FAULT", false), ("INTERIM-SERVICE", true)]);
    }

    [Fact]
    public async Task GetServiceTypes_lists_requirements_in_declared_enum_order()
    {
        // Given in reverse declared order, and stored sorted by name: neither order is the enumeration's declared order.
        var dealership = TestData.NewDealership("Ordering Motors");
        await SaveAsync(
            dealership,
            TestData.NewServiceType(
                "MULTI-SKILL-CHECK",
                60,
                [BayCapability.AirConditioning, BayCapability.Diagnostics, BayCapability.StandardLift],
                [Certification.HeavyVehicle, Certification.Brakes, Certification.GeneralService]));

        var serviceType = (await GetServiceTypesAsync(dealership.Id)).ShouldHaveSingleItem();

        serviceType.RequiredBayCapabilities.ShouldBe([BayCapability.StandardLift, BayCapability.Diagnostics, BayCapability.AirConditioning]);
        serviceType.RequiredCertifications.ShouldBe([Certification.GeneralService, Certification.Brakes, Certification.HeavyVehicle]);
    }

    [Fact]
    public async Task GetServiceTypes_returns_the_whole_catalogue_by_name_with_bookable_for_the_route_dealership()
    {
        await _factory.WithDbAsync(db => ReferenceDataSeed.EnsureSeededAsync(db, _factory.Clock, Ct));

        var reading = await GetServiceTypesAsync(ReferenceDataSeed.ReadingDealershipId);
        var munich = await GetServiceTypesAsync(ReferenceDataSeed.MunichDealershipId);

        reading.ShouldAllBe(s => s.Bookable, "Reading has a qualified bay and technician for every service");
        reading.Select(s => s.Id).ShouldBe(munich.Select(s => s.Id), "the catalogue is global; only bookable differs");
        munich.Select(s => (s.Name, s.Bookable)).ShouldBe(
        [
            ("Air-Con Regas", false),
            ("Brake Pads & Discs", true),
            ("Diagnostic Fault Finding", false),
            ("EV Battery Health Check", true),
            ("EV Charging Fault Diagnosis", false), // high-voltage and diagnostics are held by different technicians: all-of per person
            ("Four-Wheel Alignment", false),
            ("Full Service", true),
            ("Heavy Van Service", true),
            ("Interim Service", true),
            ("MOT Test", false),
        ]);

        // The wire format of one entry: duration in minutes, requirement lists as enum names in declaration order.
        using var response = await _client.GetAsync($"/api/v1/dealerships/{ReferenceDataSeed.MunichDealershipId}/service-types", Ct);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        var charging = body.RootElement.EnumerateArray().Single(s => s.GetProperty("code").GetString() == "EV-CHARGING-FAULT");
        charging.GetRawText().ShouldBe(
            $$"""{"id":"{{ReferenceDataSeed.ServiceTypeId("EV-CHARGING-FAULT")}}","code":"EV-CHARGING-FAULT","name":"EV Charging Fault Diagnosis","durationMinutes":90,"requiredBayCapabilities":["EvHighVoltage"],"requiredCertifications":["HighVoltageElectrical","Diagnostics"],"bookable":false}""");
    }

    [Fact]
    public async Task GetServiceTypes_unknown_dealership_404_problem()
    {
        var unknown = Guid.Parse("0199d2a4-0000-7000-8000-00000000dead");

        using var response = await _client.GetAsync($"/api/v1/dealerships/{unknown}/service-types", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using var problem = await response.ReadProblemAsync(Ct);
        var root = problem.RootElement;
        root.GetProperty("type").GetString().ShouldBe("https://api.keyloop.example/problems/not-found");
        root.GetProperty("title").GetString().ShouldBe("Resource not found");
        root.GetProperty("status").GetInt32().ShouldBe(404);
        root.GetProperty("detail").GetString().ShouldBe($"No dealership with id '{unknown}' exists.");
        root.GetProperty("resource").GetString().ShouldBe("dealership");
        root.GetProperty("id").GetGuid().ShouldBe(unknown);
        root.GetProperty("instance").GetString().ShouldBe($"/api/v1/dealerships/{unknown}/service-types");
        root.GetProperty("traceId").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    private async Task<IReadOnlyList<ServiceTypeResponse>> GetServiceTypesAsync(Guid dealershipId)
    {
        using var response = await _client.GetAsync($"/api/v1/dealerships/{dealershipId}/service-types", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await response.Content.ReadJsonAsync(SchedulerJsonContext.Default.IReadOnlyListServiceTypeResponse, Ct);
    }

    private Task SaveAsync(params object[] entities) => _factory.WithDbAsync(async db =>
    {
        db.AddRange(entities);
        await db.SaveChangesAsync(Ct);
    });
}

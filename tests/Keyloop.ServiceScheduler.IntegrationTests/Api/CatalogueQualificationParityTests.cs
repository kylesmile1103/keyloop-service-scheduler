using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Keyloop.ServiceScheduler.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Api;

public sealed class CatalogueQualificationParityTests(PostgresFixture pg) : IAsyncLifetime
{
    private SchedulerApiFactory _factory = null!;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new(pg.ConnectionString, TestData.Clock());
        await _factory.ResetAsync();
        // London is already on October 13 while UTC is still October 12. Expiry must use the dealership date.
        _factory.Clock.SetUtcNow(new DateTimeOffset(2026, 10, 12, 23, 30, 0, TimeSpan.Zero));
    }

    public async ValueTask DisposeAsync() => await _factory.DisposeAsync();

    [Theory]
    [InlineData(true, "hv3-without-certificate", true)]
    [InlineData(false, "hv3-without-certificate", false)]
    [InlineData(true, "legacy-certificate-only", false)]
    [InlineData(false, "legacy-certificate-only", true)]
    [InlineData(true, "expiry-today", true)]
    [InlineData(false, "expiry-today", true)]
    [InlineData(true, "expired", false)]
    [InlineData(false, "expired", true)]
    [InlineData(true, "hv2", false)]
    [InlineData(false, "hv2", true)]
    [InlineData(true, "inactive-technician", false)]
    [InlineData(false, "inactive-technician", false)]
    [InlineData(true, "inactive-bay", false)]
    [InlineData(false, "inactive-bay", false)]
    [InlineData(true, "missing-capability", false)]
    [InlineData(false, "missing-capability", false)]
    [InlineData(true, "missing-task-certification", false)]
    [InlineData(false, "missing-task-certification", false)]
    [InlineData(true, "stricter-policy", false)]
    [InlineData(false, "stricter-policy", true)]
    [InlineData(true, "empty-latest-policy", true)]
    [InlineData(false, "empty-latest-policy", true)]
    [InlineData(true, "ice-only", true)]
    [InlineData(false, "ice-only", true)]
    [InlineData(true, "only-light-commercial", true)]
    [InlineData(false, "only-light-commercial", true)]
    [InlineData(true, "only-fuel-cell", true)]
    [InlineData(false, "only-fuel-cell", true)]
    public async Task Catalogue_availability_booking_and_triage_share_qualification(bool vehicleAware, string scenario, bool bookable)
    {
        var site = TestData.NewDealership();
        var iceOnly = scenario == "ice-only";
        var code = iceOnly ? "INTERIM-SERVICE" : "EV-CHARGING-FAULT";
        var capability = iceOnly ? BayCapability.StandardLift : BayCapability.EvHighVoltage;
        var taskSkill = iceOnly ? Certification.GeneralService : Certification.Diagnostics;
        var service = TestData.NewServiceType(code, 60, [capability], iceOnly ? [taskSkill] : [taskSkill, Certification.HighVoltageElectrical]);
        var bay = ServiceBay.Create(Guid.NewGuid(), site.Id, "Only bay",
            scenario == "missing-capability" ? [BayCapability.StandardLift] : [capability], isActive: scenario != "inactive-bay");
        var technician = Technician.Create(Guid.NewGuid(), site.Id, "Only technician", "PARITY-1",
            scenario == "hv3-without-certificate" || iceOnly ? [taskSkill]
                : scenario == "missing-task-certification" ? [Certification.HighVoltageElectrical] : [taskSkill, Certification.HighVoltageElectrical],
            isActive: scenario != "inactive-technician", hvLevel: scenario == "legacy-certificate-only" || iceOnly ? 0 : scenario == "hv2" ? 2 : 3,
            hvLevelValidUntil: scenario == "expiry-today" ? TestData.BookingDay : scenario == "expired" ? TestData.BookingDay.AddDays(-1) : null,
            hvLevelConfirmed: false);
        await _factory.WithDbAsync(async db =>
        {
            db.AddRange(site, service, bay, technician);
            if (scenario is "stricter-policy" or "empty-latest-policy")
            {
                db.RequirementRules.Add(new RequirementRule
                {
                    Id = Guid.NewGuid(), DealershipId = site.Id, PolicyVersion = 3, Order = 1, Code = "all-profiles-hv4",
                    Condition = RequirementCondition.ServicePowertrain, Powertrains = Enum.GetValues<Powertrain>(),
                    ServiceCodes = [code], MinimumHvLevel = 4,
                });
                if (scenario == "empty-latest-policy")
                {
                    db.RequirementPolicyVersions.Add(new RequirementPolicyVersion { DealershipId = site.Id, Version = 4 });
                }
            }
            if (scenario == "only-light-commercial")
            {
                foreach (var vehicleClass in Enum.GetValues<VehicleClass>().Where(c => c != VehicleClass.LightCommercial))
                {
                    db.RequirementRules.Add(new RequirementRule
                    {
                        Id = Guid.NewGuid(), DealershipId = site.Id, PolicyVersion = 3, Order = 1, Code = "class-" + vehicleClass,
                        Condition = RequirementCondition.VehicleClass, VehicleClass = vehicleClass, BayCapabilities = [BayCapability.Diagnostics],
                    });
                }
            }
            if (scenario == "only-fuel-cell")
            {
                db.RequirementRules.Add(new RequirementRule
                {
                    Id = Guid.NewGuid(), DealershipId = site.Id, PolicyVersion = 3, Order = 1, Code = "other-powertrains-hv4",
                    Condition = RequirementCondition.ServicePowertrain, Powertrains = [.. Enum.GetValues<Powertrain>().Where(p => p != Powertrain.FuelCell)],
                    ServiceCodes = [code], MinimumHvLevel = 4,
                });
            }
            await db.SaveChangesAsync(Ct);
        });
        using var stub = new StubTriageHandler
        {
            ServiceChoice = bookable ? code : "NONE_OF_THESE", DateChoice = "NO_SPECIFIC_DATE",
            ServiceProbabilities = bookable ? null : new Dictionary<string, double> { ["NONE_OF_THESE"] = 1 },
        };
        await using var host = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Scheduling:VehicleAwareRequirements", vehicleAware.ToString());
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<TriageConnectionOptions>(options =>
                {
                    options.Enabled = true;
                    options.AccountId = "00000000000000000000000000000000";
                    options.ApiToken = "test-token";
                    options.BaseUrl = "https://triage.test/client/v4";
                });
                services.AddHttpClient<CloudflareTriageClient>().ConfigurePrimaryHttpMessageHandler(() => stub);
            });
        });
        using var client = host.CreateClient();
        var path = $"/api/v1/dealerships/{site.Id}";
        using var catalogue = await client.GetAsync(path + "/service-types", Ct);
        catalogue.StatusCode.ShouldBe(HttpStatusCode.OK);
        var catalogueBody = JsonNode.Parse(await catalogue.Content.ReadAsStringAsync(Ct))!;
        catalogueBody.AsArray().ShouldHaveSingleItem()!["bookable"]!.GetValue<bool>().ShouldBe(bookable);

        using var triage = await client.PostAsync(path + "/booking-triage",
            new StringContent("{\"description\":\"Inspect the vehicle\"}", Encoding.UTF8, "application/json"), Ct);
        triage.StatusCode.ShouldBe(HttpStatusCode.OK, await triage.Content.ReadAsStringAsync(Ct));
        stub.Body!["questions"]!["service"]!["criteria"]!.AsObject().ContainsKey(code).ShouldBe(bookable);
        var suggestions = JsonNode.Parse(await triage.Content.ReadAsStringAsync(Ct))!["services"]!.AsArray();
        suggestions.Count.ShouldBe(bookable ? 1 : 0);
        if (bookable) { suggestions[0]!["serviceType"]!["id"]!.GetValue<Guid>().ShouldBe(service.Id); }

        var availabilityPath = path + $"/availability?serviceTypeId={service.Id}&date=2026-10-13";
        if (vehicleAware && iceOnly)
        {
            using var unknown = await client.GetAsync(availabilityPath, Ct);
            var unknownBody = await unknown.Content.ReadJsonAsync(SchedulerJsonContext.Default.AvailabilityResponse, Ct);
            unknownBody.Slots.ShouldBeEmpty();
            unknownBody.UnavailableReason.ShouldBe("no-qualified-resources");
            availabilityPath += "&powertrain=Ice";
        }
        if (vehicleAware && scenario == "only-light-commercial") { availabilityPath += "&vehicleClass=LightCommercial"; }
        if (vehicleAware && scenario == "only-fuel-cell") { availabilityPath += "&powertrain=FuelCell"; }
        using var availability = await client.GetAsync(availabilityPath, Ct);
        availability.StatusCode.ShouldBe(HttpStatusCode.OK);
        var starts = await availability.Content.ReadJsonAsync(SchedulerJsonContext.Default.AvailabilityResponse, Ct);
        starts.Slots.Any(s => s.StartUtc == TestData.LondonTime(10)).ShouldBe(bookable);
        starts.UnavailableReason.ShouldBe(bookable ? null : "no-qualified-resources");

        var request = TestData.BookingRequest(service.Id, TestData.LondonTime(10));
        if (vehicleAware && iceOnly)
        {
            request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: "Advisor checked the powertrain") } };
        }
        if (vehicleAware && scenario == "only-light-commercial")
        {
            request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(VehicleClass: VehicleClass.LightCommercial) } };
        }
        if (vehicleAware && scenario == "only-fuel-cell")
        {
            request = request with { Vehicle = request.Vehicle with { Profile = new VehicleProfileRequest(Powertrain.FuelCell, DeclarationReason: "Advisor checked the powertrain") } };
        }
        using var booking = await client.PostJsonAsync(path + "/appointments", request, SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
        if (bookable)
        {
            booking.StatusCode.ShouldBe(HttpStatusCode.Created, await booking.Content.ReadAsStringAsync(Ct));
            var appointment = await booking.Content.ReadJsonAsync(SchedulerJsonContext.Default.AppointmentResponse, Ct);
            appointment.Technician.Id.ShouldBe(technician.Id);
            if (vehicleAware) { appointment.Allocation.ShouldNotBeNull().MinimumHvLevel.ShouldBe(iceOnly ? 0 : 3); }
            else { appointment.Allocation.ShouldBeNull(); }

            if (vehicleAware && scenario == "expiry-today")
            {
                using var tomorrow = await client.GetAsync(path + $"/availability?serviceTypeId={service.Id}&date=2026-10-14", Ct);
                var tomorrowStarts = await tomorrow.Content.ReadJsonAsync(SchedulerJsonContext.Default.AvailabilityResponse, Ct);
                tomorrowStarts.Slots.ShouldBeEmpty();
                tomorrowStarts.UnavailableReason.ShouldBe("no-qualified-resources");
                using var futureBooking = await client.PostJsonAsync(path + "/appointments", request with { StartUtc = request.StartUtc.AddDays(1) },
                    SchedulerJsonContext.Default.BookAppointmentRequest, Ct);
                await futureBooking.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct);
                using var currentCatalogue = await client.GetAsync(path + "/service-types", Ct);
                JsonNode.Parse(await currentCatalogue.Content.ReadAsStringAsync(Ct))!.AsArray().ShouldHaveSingleItem()!["bookable"]!.GetValue<bool>().ShouldBeTrue();
            }
        }
        else { await booking.ShouldBeProblemAsync(HttpStatusCode.UnprocessableEntity, "no-qualified-resources", Ct); }
        await _factory.WithDbAsync(async db =>
        {
            (await db.Appointments.CountAsync(Ct)).ShouldBe(bookable ? 1 : 0);
            (await db.AppointmentHistory.CountAsync(Ct)).ShouldBe(bookable ? 1 : 0);
            (await db.NotificationOutbox.CountAsync(Ct)).ShouldBe(bookable ? 1 : 0);
        });
    }
}

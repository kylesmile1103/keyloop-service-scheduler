using System.Text.Json;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Api.Features.Schedule.Mapping;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Vehicles;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

public sealed class VehicleProfileTests
{
    [Theory]
    [InlineData("WVW", "VOLKSWAGEN")]
    [InlineData("WBA", "BMW")]
    [InlineData("WDD", "MERCEDES-BENZ")]
    [InlineData("VF1", "RENAULT")]
    [InlineData("JTD", "TOYOTA")]
    [InlineData("5YJ", "TESLA")]
    [InlineData("ZZZ", "UNKNOWN")]
    public void WMI_is_manufacturer_only_with_exact_provenance(string wmi, string manufacturer)
    {
        var result = WmiDecoder.Decode(Vin.Create($"{wmi}ZZZ1KZAW123456"));
        result.Manufacturer.ShouldBe(manufacturer);
        result.Powertrain.ShouldBe(Powertrain.Unknown);
        result.VehicleClass.ShouldBe(VehicleClass.Unknown);
        result.Provenance.Manufacturer.ShouldBe(manufacturer == "UNKNOWN" ? ProfileSource.Unknown : ProfileSource.VinDecoded);
        result.Provenance.Powertrain.ShouldBe(ProfileSource.Unknown);
        result.Provenance.VehicleClass.ShouldBe(ProfileSource.Unknown);
        WmiDecoder.Decode(null).ShouldBe(VehicleProfile.Unknown);
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(500, true)]
    [InlineData(501, false)]
    public void Declaration_reason_is_bounded_after_trimming(int length, bool valid)
    {
        var request = new VehicleProfileRequest(Powertrain.Ice, DeclarationReason: "  " + new string('x', length) + "  ");
        new VehicleProfileRequestValidator().Validate(request).IsValid.ShouldBe(valid);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(100)]
    public void Profile_enums_and_conflict_choice_are_validated(int invalid)
    {
        var request = new VehicleProfileRequest((Powertrain)invalid, VehicleClass: (VehicleClass)invalid, ConflictChoice: (ProfileConflictChoice)invalid);
        new VehicleProfileRequestValidator().Validate(request).IsValid.ShouldBeFalse();
    }

    [Theory]
    [InlineData("Heavy", true)]
    [InlineData("heavy", true)]
    [InlineData("HEAVY", true)]
    [InlineData("Heavy, LightCommercial", false)]
    [InlineData("Heavy,LightCommercial", false)]
    [InlineData("Car,Heavy", false)]
    [InlineData("2", false)]
    [InlineData(" Heavy", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Exact_enum_names_accept_one_member_and_nothing_else(string? text, bool accepted)
    {
        ExactEnumName.TryParse<VehicleClass>(text, out var value).ShouldBe(accepted);
        if (accepted)
        {
            value.ShouldBe(VehicleClass.Heavy);
        }
    }

    [Theory]
    [InlineData("{\"vehicleClass\":\"Heavy, LightCommercial\"}")]
    [InlineData("{\"vehicleClass\":2}")]
    [InlineData("{\"vehicleClass\":\"2\"}")]
    [InlineData("{\"powertrain\":\"Ice, BatteryElectric\"}")]
    [InlineData("{\"powertrain\":4}")]
    [InlineData("{\"powertrain\":null}")]
    [InlineData("{\"conflictChoice\":0}")]
    [InlineData("{\"conflictChoice\":\"UseDecoded,UseDecoded\"}")]
    public void Declared_profile_JSON_rejects_lists_and_numbers(string json) =>
        Should.Throw<JsonException>(() => JsonSerializer.Deserialize(json, SchedulerJsonContext.Default.VehicleProfileRequest));

    [Fact]
    public void Declared_profile_JSON_round_trips_member_names()
    {
        var request = JsonSerializer.Deserialize("{\"powertrain\":\"batteryelectric\",\"vehicleClass\":\"Heavy\",\"conflictChoice\":\"UseDecoded\"}",
            SchedulerJsonContext.Default.VehicleProfileRequest).ShouldNotBeNull();
        request.ShouldBe(new VehicleProfileRequest(Powertrain.BatteryElectric, VehicleClass: VehicleClass.Heavy, ConflictChoice: ProfileConflictChoice.UseDecoded));
        JsonSerializer.Serialize(request, SchedulerJsonContext.Default.VehicleProfileRequest).ShouldBe(
            "{\"powertrain\":\"BatteryElectric\",\"manufacturer\":null,\"vehicleClass\":\"Heavy\",\"declarationReason\":null,\"conflictChoice\":\"UseDecoded\"}");
        JsonSerializer.Deserialize("{\"conflictChoice\":null}", SchedulerJsonContext.Default.VehicleProfileRequest).ShouldNotBeNull().ConflictChoice.ShouldBeNull();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Competence_API_fields_are_visible_only_when_enabled(bool enabled)
    {
        var technician = Technician.Create(Guid.NewGuid(), Guid.NewGuid(), "Tech", "T", [], hvLevel: 3, hvLevelConfirmed: false, brandSpecialisms: ["vw"]);
        var response = ScheduleMapper.ToResponse(technician, enabled);
        response.HvLevel.ShouldBe(enabled ? 3 : null);
        response.HvLevelConfirmed.ShouldBe(enabled ? false : null);
        response.BrandSpecialisms.ShouldBe(enabled ? new[] { "VW" } : null);
    }
}

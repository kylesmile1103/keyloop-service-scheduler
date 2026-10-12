using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class VehicleAwareRequirements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "brand_specialisms",
                table: "technicians",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<short>(
                name: "hv_level",
                table: "technicians",
                type: "smallint",
                nullable: false,
                defaultValue: (short)0);

            migrationBuilder.AddColumn<bool>(
                name: "hv_level_confirmed",
                table: "technicians",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "hv_level_valid_until",
                table: "technicians",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "allocation_decision",
                table: "appointments",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "needs_live_diagnosis",
                table: "appointments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "vehicle_class",
                table: "appointments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Unknown");

            migrationBuilder.AddColumn<string>(
                name: "vehicle_manufacturer",
                table: "appointments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "UNKNOWN");

            migrationBuilder.AddColumn<string>(
                name: "vehicle_powertrain",
                table: "appointments",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Unknown");

            migrationBuilder.AddColumn<string>(
                name: "vehicle_profile_provenance",
                table: "appointments",
                type: "jsonb",
                nullable: false,
                defaultValue: "{\"powertrain\":\"Unknown\",\"manufacturer\":\"Unknown\",\"vehicleClass\":\"Unknown\",\"declaredBy\":null,\"declarationReason\":null}");

            // Faithful translation of the former component-work gate; confirmation is deliberately not invented by migration.
            migrationBuilder.Sql("UPDATE technicians SET hv_level = 3 WHERE certifications @> ARRAY['HighVoltageElectrical']::text[];");

            migrationBuilder.CreateTable(
                name: "requirement_rules",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    policy_version = table.Column<int>(type: "integer", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    condition = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    powertrains = table.Column<string[]>(type: "text[]", nullable: false),
                    service_codes = table.Column<string[]>(type: "text[]", nullable: false),
                    vehicle_class = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    minimum_hv_level = table.Column<int>(type: "integer", nullable: false),
                    bay_capabilities = table.Column<string[]>(type: "text[]", nullable: false),
                    certifications = table.Column<string[]>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requirement_rules", x => x.id);
                    table.CheckConstraint("ck_requirement_rules_hv_level", "minimum_hv_level BETWEEN 0 AND 4");
                    table.CheckConstraint("ck_requirement_rules_policy_version", "policy_version > 0");
                    table.ForeignKey(
                        name: "fk_requirement_rules_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_technicians_brand_specialisms",
                table: "technicians",
                column: "brand_specialisms")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.AddCheckConstraint(
                name: "ck_technicians_hv_level",
                table: "technicians",
                sql: "hv_level BETWEEN 0 AND 4");

            migrationBuilder.CreateIndex(
                name: "ix_requirement_rules_dealership_id_policy_version_code",
                table: "requirement_rules",
                columns: new[] { "dealership_id", "policy_version", "code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "requirement_rules");

            migrationBuilder.DropIndex(
                name: "ix_technicians_brand_specialisms",
                table: "technicians");

            migrationBuilder.DropCheckConstraint(
                name: "ck_technicians_hv_level",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "brand_specialisms",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "hv_level",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "hv_level_confirmed",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "hv_level_valid_until",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "allocation_decision",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "needs_live_diagnosis",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "vehicle_class",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "vehicle_manufacturer",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "vehicle_powertrain",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "vehicle_profile_provenance",
                table: "appointments");
        }
    }
}

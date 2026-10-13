using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AdminEditing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "technicians",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "service_bays",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<string>(
                name: "recorded_requirements",
                table: "appointments",
                type: "jsonb",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "admin_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    resource_kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    resource_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    before = table.Column<string>(type: "jsonb", nullable: true),
                    after = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_admin_changes", x => x.id);
                    table.CheckConstraint("ck_admin_changes_after_bound", "octet_length(after::text) <= 65536");
                    table.CheckConstraint("ck_admin_changes_before_bound", "before IS NULL OR octet_length(before::text) <= 65536");
                    table.ForeignKey(
                        name: "fk_admin_changes_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "requirement_policy_versions",
                columns: table => new
                {
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requirement_policy_versions", x => new { x.dealership_id, x.version });
                    table.CheckConstraint("ck_requirement_policy_versions_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_requirement_policy_versions_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_admin_changes_dealership_id_at_utc_id",
                table: "admin_changes",
                columns: new[] { "dealership_id", "at_utc", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_changes");

            migrationBuilder.DropTable(
                name: "requirement_policy_versions");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "technicians");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "service_bays");

            migrationBuilder.DropColumn(
                name: "recorded_requirements",
                table: "appointments");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:btree_gist", ",,");

            migrationBuilder.CreateTable(
                name: "dealerships",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    time_zone_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_dealerships", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "idempotency_keys",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    request_fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    response_status = table.Column<int>(type: "integer", nullable: false),
                    response_body = table.Column<string>(type: "jsonb", nullable: false),
                    resource_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_idempotency_keys", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "service_types",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    duration_minutes = table.Column<int>(type: "integer", nullable: false),
                    required_bay_capabilities = table.Column<string[]>(type: "text[]", nullable: false),
                    required_certifications = table.Column<string[]>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_service_types", x => x.id);
                    table.CheckConstraint("ck_service_types_duration_minutes", "duration_minutes > 0 AND duration_minutes % 5 = 0 AND duration_minutes <= 480");
                });

            migrationBuilder.CreateTable(
                name: "dealership_operating_hours",
                columns: table => new
                {
                    day_of_week = table.Column<short>(type: "smallint", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    opens_at = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    closes_at = table.Column<TimeOnly>(type: "time without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_dealership_operating_hours", x => new { x.dealership_id, x.day_of_week });
                    table.CheckConstraint("ck_dealership_operating_hours_open_before_close", "(opens_at IS NULL AND closes_at IS NULL) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)");
                    table.ForeignKey(
                        name: "fk_dealership_operating_hours_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "service_bays",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    capabilities = table.Column<string[]>(type: "text[]", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_service_bays", x => x.id);
                    table.ForeignKey(
                        name: "fk_service_bays_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "technicians",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    employee_number = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    certifications = table.Column<string[]>(type: "text[]", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_technicians", x => x.id);
                    table.ForeignKey(
                        name: "fk_technicians_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "appointments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dealership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    service_type_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bay_id = table.Column<Guid>(type: "uuid", nullable: false),
                    technician_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    cancellation_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    time_range = table.Column<NpgsqlRange<DateTime>>(type: "tstzrange", nullable: false, computedColumnSql: "tstzrange(start_utc, end_utc, '[)')", stored: true),
                    customer_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    customer_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    customer_phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    end_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    start_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    vehicle_make = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    vehicle_model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    vehicle_registration = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    vehicle_vin = table.Column<string>(type: "character varying(17)", maxLength: 17, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_appointments", x => x.id);
                    table.CheckConstraint("ck_appointments_end_after_start", "end_utc > start_utc");
                    table.CheckConstraint("ck_appointments_vin_format", "vehicle_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'");
                    table.ForeignKey(
                        name: "fk_appointments_dealerships_dealership_id",
                        column: x => x.dealership_id,
                        principalTable: "dealerships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_appointments_service_bays_bay_id",
                        column: x => x.bay_id,
                        principalTable: "service_bays",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_appointments_service_types_service_type_id",
                        column: x => x.service_type_id,
                        principalTable: "service_types",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_appointments_technicians_technician_id",
                        column: x => x.technician_id,
                        principalTable: "technicians",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "appointment_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    appointment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    actor = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_appointment_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_appointment_history_appointments_appointment_id",
                        column: x => x.appointment_id,
                        principalTable: "appointments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_appointment_history_appointment_id_occurred_at_utc",
                table: "appointment_history",
                columns: new[] { "appointment_id", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_appointments_bay_id",
                table: "appointments",
                column: "bay_id");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_dealership_id",
                table: "appointments",
                column: "dealership_id");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_service_type_id",
                table: "appointments",
                column: "service_type_id");

            migrationBuilder.CreateIndex(
                name: "ix_appointments_technician_id",
                table: "appointments",
                column: "technician_id");

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_keys_expires_at_utc",
                table: "idempotency_keys",
                column: "expires_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_service_bays_capabilities",
                table: "service_bays",
                column: "capabilities")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "ix_service_bays_dealership_id",
                table: "service_bays",
                column: "dealership_id");

            migrationBuilder.CreateIndex(
                name: "ix_service_types_code",
                table: "service_types",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_technicians_certifications",
                table: "technicians",
                column: "certifications")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "ix_technicians_dealership_id_employee_number",
                table: "technicians",
                columns: new[] { "dealership_id", "employee_number" },
                unique: true);

            // Hand-written: EF Core cannot model these. The overlap invariant (SYSTEM_DESIGN §7.3 layer 1): partial GiST exclusion
            // constraints over the stored generated time_range; the WHERE list is Appointment.ActiveStatuses.
            migrationBuilder.Sql("""
                ALTER TABLE appointments ADD CONSTRAINT ex_appointments_bay_no_overlap
                    EXCLUDE USING gist (bay_id WITH =, time_range WITH &&)
                    WHERE (status IN ('Confirmed', 'CheckedIn', 'InProgress'));
                ALTER TABLE appointments ADD CONSTRAINT ex_appointments_technician_no_overlap
                    EXCLUDE USING gist (technician_id WITH =, time_range WITH &&)
                    WHERE (status IN ('Confirmed', 'CheckedIn', 'InProgress'));
                """);

            // The day-query index (SYSTEM_DESIGN §8.8); start_utc belongs to the Slot complex property, which EF cannot index.
            migrationBuilder.CreateIndex(
                name: "ix_appointments_dealership_id_start_utc",
                table: "appointments",
                columns: new[] { "dealership_id", "start_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_appointments_dealership_id_start_utc",
                table: "appointments");

            migrationBuilder.Sql("""
                ALTER TABLE appointments DROP CONSTRAINT ex_appointments_technician_no_overlap;
                ALTER TABLE appointments DROP CONSTRAINT ex_appointments_bay_no_overlap;
                """);

            migrationBuilder.DropTable(
                name: "appointment_history");

            migrationBuilder.DropTable(
                name: "dealership_operating_hours");

            migrationBuilder.DropTable(
                name: "idempotency_keys");

            migrationBuilder.DropTable(
                name: "appointments");

            migrationBuilder.DropTable(
                name: "service_bays");

            migrationBuilder.DropTable(
                name: "service_types");

            migrationBuilder.DropTable(
                name: "technicians");

            migrationBuilder.DropTable(
                name: "dealerships");
        }
    }
}

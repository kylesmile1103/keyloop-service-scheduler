using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "notification_outbox",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    appointment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    recipient = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    next_attempt_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    claim_token = table.Column<Guid>(type: "uuid", nullable: true),
                    sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_failure = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_outbox", x => x.id);
                    table.UniqueConstraint("ak_notification_outbox_appointment_id_kind", x => new { x.appointment_id, x.kind });
                    table.CheckConstraint("ck_notification_outbox_attempts", "attempts >= 0");
                    table.CheckConstraint("ck_notification_outbox_kind", "kind IN ('BookingConfirmation', 'Cancellation')");
                    table.CheckConstraint("ck_notification_outbox_status", "status IN ('Pending', 'Sent', 'Failed', 'Suppressed')");
                    table.ForeignKey(
                        name: "fk_notification_outbox_appointments_appointment_id",
                        column: x => x.appointment_id,
                        principalTable: "appointments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            // EF models the alternate key but has no deferrable unique-constraint API. Replace only its timing semantics.
            // Let a stale cancellation's xmin UPDATE fail before duplicate outbox checking; uniqueness still holds at commit.
            migrationBuilder.Sql("""
                ALTER TABLE notification_outbox DROP CONSTRAINT ak_notification_outbox_appointment_id_kind;
                ALTER TABLE notification_outbox ADD CONSTRAINT ak_notification_outbox_appointment_id_kind
                    UNIQUE (appointment_id, kind) DEFERRABLE INITIALLY DEFERRED;
                """);

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_next_attempt_at_id",
                table: "notification_outbox",
                columns: new[] { "next_attempt_at", "id" },
                filter: "status = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notification_outbox");
        }
    }
}

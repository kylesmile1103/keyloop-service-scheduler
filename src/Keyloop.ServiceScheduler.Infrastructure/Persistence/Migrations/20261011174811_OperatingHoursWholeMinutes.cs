using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OperatingHoursWholeMinutes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "ck_dealership_operating_hours_whole_minutes",
                table: "dealership_operating_hours",
                sql: "EXTRACT(SECOND FROM opens_at) = 0 AND EXTRACT(SECOND FROM closes_at) = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_dealership_operating_hours_whole_minutes",
                table: "dealership_operating_hours");
        }
    }
}

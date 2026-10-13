using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerLookupScopedNamePrefixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Additive rollout: retain the fleet-wide function/index for the previous API until a later cleanup migration.
            // Qualifying every prefix makes array_ops GIN posting lists dealership-scoped without btree_gin.
            migrationBuilder.Sql("""
                CREATE FUNCTION public.customer_lookup_scoped_name_prefixes(dealership uuid, value text) RETURNS text[]
                LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
                AS $function$
                    SELECT coalesce(array_agg(dealership::text || ':' || left(word, size)), ARRAY[]::text[])
                    FROM regexp_split_to_table(lower(value), '[[:space:]]+') AS word
                    CROSS JOIN LATERAL generate_series(3, length(word)) AS size
                $function$;

                CREATE INDEX ix_appointments_lookup_name_scoped ON appointments USING gin
                    (public.customer_lookup_scoped_name_prefixes(dealership_id, customer_name));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX ix_appointments_lookup_name_scoped;
                DROP FUNCTION public.customer_lookup_scoped_name_prefixes(uuid, text);
                """);
        }
    }
}

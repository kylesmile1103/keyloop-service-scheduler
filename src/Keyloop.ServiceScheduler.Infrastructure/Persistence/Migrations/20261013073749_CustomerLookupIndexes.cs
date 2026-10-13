using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerLookupIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Prefixes of whitespace-separated name words preserve literal spelling (no stemming, stop words or punctuation
            // tokenization). Built-in array_ops GIN needs no extension. The bounded 120-character name bounds index fan-out.
            // GIN handles repeated prefix keys itself. DISTINCT here would add a sort with inflated SRF estimates and per-call JIT.
            migrationBuilder.Sql("""
                CREATE FUNCTION public.customer_lookup_name_prefixes(value text) RETURNS text[]
                LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
                AS $function$
                    SELECT coalesce(array_agg(left(word, size)), ARRAY[]::text[])
                    FROM regexp_split_to_table(lower(value), '[[:space:]]+') AS word
                    CROSS JOIN LATERAL generate_series(3, length(word)) AS size
                $function$;

                CREATE INDEX ix_appointments_lookup_email ON appointments (dealership_id, lower(customer_email) text_pattern_ops);
                CREATE INDEX ix_appointments_lookup_registration ON appointments
                    (dealership_id, regexp_replace(upper(vehicle_registration), '[[:space:]]', '', 'g') text_pattern_ops);
                CREATE INDEX ix_appointments_lookup_phone ON appointments
                    (dealership_id, regexp_replace(customer_phone, '[^0-9]', '', 'g') text_pattern_ops);
                CREATE INDEX ix_appointments_lookup_phone_reverse ON appointments
                    (dealership_id, reverse(regexp_replace(customer_phone, '[^0-9]', '', 'g')) text_pattern_ops);
                CREATE INDEX ix_appointments_lookup_name ON appointments USING gin (public.customer_lookup_name_prefixes(customer_name));
                CREATE INDEX ix_appointments_lookup_pair ON appointments
                    (dealership_id, lower(customer_email), vehicle_vin, start_utc DESC, id DESC);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX ix_appointments_lookup_pair;
                DROP INDEX ix_appointments_lookup_name;
                DROP INDEX ix_appointments_lookup_phone_reverse;
                DROP INDEX ix_appointments_lookup_phone;
                DROP INDEX ix_appointments_lookup_registration;
                DROP INDEX ix_appointments_lookup_email;
                DROP FUNCTION public.customer_lookup_name_prefixes(text);
                """);
        }
    }
}

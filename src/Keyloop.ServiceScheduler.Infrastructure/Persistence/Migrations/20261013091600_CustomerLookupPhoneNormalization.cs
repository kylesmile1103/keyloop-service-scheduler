using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerLookupPhoneNormalization : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Additive rollout: the previous API keeps its digit-only phone expressions and indexes unchanged.
            // Use this same function on the indexed value and the bound query, with no application-side country logic.
            migrationBuilder.Sql("""
                CREATE FUNCTION public.customer_lookup_phone_key(value text) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
                AS $function$
                    SELECT regexp_replace(CASE
                        WHEN compact LIKE '+44%' OR compact LIKE '+49%' THEN substr(compact, 4)
                        WHEN compact LIKE '0044%' OR compact LIKE '0049%' THEN substr(compact, 5)
                        WHEN compact LIKE '0%' AND compact NOT LIKE '00%' THEN substr(compact, 2)
                        ELSE compact
                    END, '[^0-9]', '', 'g')
                    FROM (SELECT regexp_replace(value, '[^0-9+]', '', 'g') AS compact) AS normalized
                $function$;

                CREATE INDEX ix_appointments_lookup_phone_key ON appointments
                    (dealership_id, public.customer_lookup_phone_key(customer_phone) text_pattern_ops);
                CREATE INDEX ix_appointments_lookup_phone_key_reverse ON appointments
                    (dealership_id, reverse(public.customer_lookup_phone_key(customer_phone)) text_pattern_ops);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX ix_appointments_lookup_phone_key_reverse;
                DROP INDEX ix_appointments_lookup_phone_key;
                DROP FUNCTION public.customer_lookup_phone_key(text);
                """);
        }
    }
}

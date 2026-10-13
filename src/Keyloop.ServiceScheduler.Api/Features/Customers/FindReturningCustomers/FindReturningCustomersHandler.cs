using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

/// <summary>Read-only projection of dealership-scoped history. Personal data is bound as parameters, never SQL text.</summary>
public sealed class FindReturningCustomersHandler(SchedulerDbContext db, ILogger<FindReturningCustomersHandler> logger)
{
    public async Task<IReadOnlyList<ReturningCustomerResponse>> HandleAsync(Guid dealershipId, FindReturningCustomersRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await db.Dealerships.AnyAsync(d => d.Id == dealershipId, ct))
        {
            throw new NotFoundException(ProblemResources.Dealership, dealershipId);
        }
        var query = request.Query.Trim();
        var kind = CustomerLookupQuery.Kind(query);
        var nameWords = CustomerLookupQuery.NameWords(query);
        var results = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await db.Database.OpenConnectionAsync(ct);
            try
            {
                await using var command = db.Database.GetDbConnection().CreateCommand();
                command.CommandText = Sql(kind, nameWords.Length > 0);
                command.CommandTimeout = db.Database.GetCommandTimeout() ?? 30;
                command.Parameters.Add(new NpgsqlParameter("dealership", dealershipId));
                command.Parameters.Add(new NpgsqlParameter("query", query));
                command.Parameters.Add(new NpgsqlParameter("nameWords", nameWords));
                command.Parameters.Add(new NpgsqlParameter("prefix", CustomerLookupQuery.Prefix(kind == CustomerLookupKind.Phone
                    ? CustomerLookupQuery.Digits(query) : kind == CustomerLookupKind.Email ? query : string.Concat(query.Where(c => !char.IsWhiteSpace(c))))));
                command.Parameters.Add(new NpgsqlParameter("reversePrefix", CustomerLookupQuery.Prefix(string.Concat(CustomerLookupQuery.Digits(query).Reverse()))));
                await using var reader = await command.ExecuteReaderAsync(ct);
                var rows = new List<ReturningCustomerResponse>();
                while (await reader.ReadAsync(ct))
                {
                    rows.Add(new(new(reader.GetString(0), reader.GetString(1), reader.GetString(2)),
                        new(reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.GetString(6)), reader.GetDateTime(7), reader.GetInt64(8)));
                }
                return rows;
            }
            finally
            {
                await db.Database.CloseConnectionAsync();
            }
        });
        SchedulerLog.CustomerLookupCompleted(logger, kind, results.Count);
        return results;
    }

    // UNION keeps each search branch independently indexable. Find pairs first, then read ALL their history so old matches
    // cannot return stale fields or undercount visits. Both reads retain the dealership predicate.
    internal static string Sql(CustomerLookupKind kind, bool includeNames = true)
    {
        var candidates = kind switch
        {
            CustomerLookupKind.Email => """
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND lower(customer_email) LIKE lower(@prefix) ESCAPE '\'
                """,
            // Retain the digit-only branches for legacy country-inclusive partial prefixes, such as 447700.
            CustomerLookupKind.Phone => """
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND length(public.customer_lookup_phone_key(@query)) >= 6
                    AND public.customer_lookup_phone_key(@query) <> regexp_replace(@query, '[^0-9]', '', 'g')
                    AND public.customer_lookup_phone_key(customer_phone) LIKE public.customer_lookup_phone_key(@query) || '%'
                UNION
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND length(public.customer_lookup_phone_key(@query)) >= 6
                    AND reverse(public.customer_lookup_phone_key(customer_phone)) LIKE reverse(public.customer_lookup_phone_key(@query)) || '%'
                UNION
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND regexp_replace(customer_phone, '[^0-9]', '', 'g') LIKE @prefix
                UNION
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND reverse(regexp_replace(customer_phone, '[^0-9]', '', 'g')) LIKE @reversePrefix
                """,
            _ => """
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND regexp_replace(upper(vehicle_registration), '[[:space:]]', '', 'g') LIKE upper(@prefix) ESCAPE '\'
                """ + (includeNames ? """

                UNION
                SELECT lower(customer_email) AS email, vehicle_vin AS vin FROM appointments
                WHERE dealership_id = @dealership AND public.customer_lookup_name_prefixes(customer_name)
                    @> ARRAY(SELECT lower(word) FROM unnest(@nameWords::text[]) AS word)
                """ : ""),
        };
        return $$"""
            WITH pairs AS (SELECT DISTINCT email, vin FROM ({{candidates}}) AS matches)
            SELECT latest.customer_name, latest.customer_email, latest.customer_phone,
                   latest.vehicle_vin, latest.vehicle_registration, latest.vehicle_make, latest.vehicle_model,
                   latest.start_utc, visits.total
            FROM pairs
            CROSS JOIN LATERAL (
                SELECT id, customer_name, customer_email, customer_phone, vehicle_vin, vehicle_registration, vehicle_make, vehicle_model, start_utc
                FROM appointments
                WHERE dealership_id = @dealership AND lower(customer_email) = pairs.email AND vehicle_vin = pairs.vin
                ORDER BY start_utc DESC, id DESC LIMIT 1
            ) AS latest
            CROSS JOIN LATERAL (
                SELECT count(*) AS total FROM appointments
                WHERE dealership_id = @dealership AND lower(customer_email) = pairs.email AND vehicle_vin = pairs.vin
            ) AS visits
            ORDER BY latest.start_utc DESC, latest.id DESC LIMIT 8
            """;
    }
}

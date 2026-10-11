using Keyloop.ServiceScheduler.Api.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class PostgresErrorClassifierTests
{
    // Literal SQLSTATEs and constraint names: these pin the migration's names and PostgreSQL's codes, not the classifier's constants.
    public static TheoryData<string, string?, PostgresFailure> Cases => new()
    {
        { "23P01", "ex_appointments_bay_no_overlap", PostgresFailure.BayOverlap },
        { "23P01", "ex_appointments_technician_no_overlap", PostgresFailure.TechnicianOverlap },
        { "23P01", "ex_some_other_exclusion", PostgresFailure.Other },
        { "23505", "pk_idempotency_keys", PostgresFailure.IdempotencyKeyDuplicate },
        { "23505", "ix_service_types_code", PostgresFailure.Other },
        { "40P01", null, PostgresFailure.Deadlock },
        { "23514", "ck_appointments_status", PostgresFailure.CheckViolation },
        { "42P01", null, PostgresFailure.Other },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void Classifies_a_postgres_exception_by_sqlstate_and_constraint(string sqlState, string? constraint, PostgresFailure expected) =>
        PostgresErrorClassifier.Classify(Postgres(sqlState, constraint)).ShouldBe(expected);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Classifies_the_postgres_exception_inside_a_DbUpdateException(string sqlState, string? constraint, PostgresFailure expected) =>
        PostgresErrorClassifier.Classify(new DbUpdateException("Saving failed.", Postgres(sqlState, constraint))).ShouldBe(expected);

    [Fact]
    public void Finds_the_postgres_exception_anywhere_in_the_inner_exception_chain()
    {
        var nested = new DbUpdateException("Saving failed.", new InvalidOperationException("Wrapped.", Postgres("40P01", null)));

        PostgresErrorClassifier.Classify(nested).ShouldBe(PostgresFailure.Deadlock);
    }

    [Fact]
    public void Returns_None_when_no_postgres_exception_is_involved()
    {
        PostgresErrorClassifier.Classify(new InvalidOperationException("Not a database error.")).ShouldBe(PostgresFailure.None);
        PostgresErrorClassifier.Classify(new DbUpdateException("Saving failed.", new TimeoutException())).ShouldBe(PostgresFailure.None);
    }

    [Fact]
    public void Rejects_null() => Should.Throw<ArgumentNullException>(() => PostgresErrorClassifier.Classify(null!));

    private static PostgresException Postgres(string sqlState, string? constraint) =>
        new("simulated failure", "ERROR", "ERROR", sqlState, constraintName: constraint);
}

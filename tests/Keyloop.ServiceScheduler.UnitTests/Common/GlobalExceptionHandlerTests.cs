using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Keyloop.ServiceScheduler.UnitTests.Common;

public class GlobalExceptionHandlerTests
{
    private const string Path = "/api/v1/dealerships/5b1e/appointments";

    private static readonly SuggestedSlot Nine = new(new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), "2026-10-13T09:00:00+01:00");
    private static readonly SuggestedSlot Ten = new(new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc), "2026-10-13T10:00:00+01:00");

    private readonly RecordingProblemDetailsService _problems = new();
    private readonly CapturingLogger<GlobalExceptionHandler> _logger = new();

    [Fact]
    public async Task Rule_violation_is_422_with_the_rule_slug_detail_and_extensions()
    {
        var window = new OperatingWindow(new DateTime(2026, 10, 13, 7, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 13, 17, 0, 0, DateTimeKind.Utc));
        var exception = new DomainRuleViolationException("outside-operating-hours", "The slot is outside the operating hours.", new Dictionary<string, object?> { ["operatingWindow"] = window });

        var (http, problem) = await HandleAsync(exception);

        http.Response.StatusCode.ShouldBe(422);
        problem.Status.ShouldBe(422);
        problem.Type.ShouldBe("https://api.keyloop.example/problems/outside-operating-hours");
        problem.Title.ShouldBe("Outside operating hours");
        problem.Detail.ShouldBe("The slot is outside the operating hours.");
        problem.Instance.ShouldBe(Path);
        problem.Extensions["operatingWindow"].ShouldBe(window);
    }

    [Fact]
    public async Task Rule_code_outside_the_catalogue_still_maps_to_422_under_the_problem_base()
    {
        var (_, problem) = await HandleAsync(new DomainRuleViolationException("no-show-before-slot-end", "Too early."));
        problem.Type.ShouldBe("https://api.keyloop.example/problems/no-show-before-slot-end");
        problem.Title.ShouldBe("No-show before slot end");

        var (_, unknown) = await HandleAsync(new DomainRuleViolationException("some-future-rule", "A rule added later."));
        unknown.Status.ShouldBe(422);
        unknown.Type.ShouldBe("https://api.keyloop.example/problems/some-future-rule");
        unknown.Title.ShouldBe("Business rule violated");
    }

    [Fact]
    public async Task Invalid_transition_is_409_with_current_status_and_the_attempted_token()
    {
        var (http, problem) = await HandleAsync(new InvalidStateTransitionException(AppointmentStatus.Cancelled, "cancel"));

        http.Response.StatusCode.ShouldBe(409);
        problem.Type.ShouldBe(ProblemTypes.InvalidStateTransition);
        problem.Title.ShouldBe("Invalid state transition");
        problem.Detail.ShouldBe("Cannot cancel this appointment while it is Cancelled.");
        problem.Extensions["currentStatus"].ShouldBe(AppointmentStatus.Cancelled);
        problem.Extensions["attempted"].ShouldBe("cancel");
    }

    [Fact]
    public async Task Not_found_is_404_with_resource_and_id()
    {
        var id = Guid.NewGuid();
        var (http, problem) = await HandleAsync(new NotFoundException("Appointment", id));

        http.Response.StatusCode.ShouldBe(404);
        problem.Type.ShouldBe(ProblemTypes.NotFound);
        problem.Title.ShouldBe("Resource not found");
        problem.Detail.ShouldBe($"Appointment '{id}' was not found.");
        problem.Extensions["resource"].ShouldBe("Appointment");
        problem.Extensions["id"].ShouldBe(id);
    }

    [Fact]
    public async Task Slot_unavailable_is_409_with_suggested_slots_as_an_array()
    {
        var (http, problem) = await HandleAsync(new SlotUnavailableException(new List<SuggestedSlot> { Nine, Ten }));

        http.Response.StatusCode.ShouldBe(409);
        problem.Type.ShouldBe(ProblemTypes.SlotUnavailable);
        problem.Title.ShouldBe("Slot unavailable");

        // JSON serialises object-typed extensions by runtime type: a List<SuggestedSlot> would need its own JSON metadata.
        problem.Extensions["suggestedSlots"].ShouldBeOfType<SuggestedSlot[]>().ShouldBe([Nine, Ten]);
    }

    [Fact]
    public async Task Slot_conflict_is_409_with_suggestions_and_the_conflicting_resource()
    {
        var (http, problem) = await HandleAsync(new SlotConflictException("bay", [Ten]));

        http.Response.StatusCode.ShouldBe(409);
        problem.Type.ShouldBe(ProblemTypes.SlotConflict);
        problem.Title.ShouldBe("Slot conflict");
        problem.Detail.ShouldBe("The slot was taken by a concurrent booking.");
        problem.Extensions["conflictingResource"].ShouldBe("bay");
        problem.Extensions["suggestedSlots"].ShouldBeOfType<SuggestedSlot[]>().ShouldBe([Ten]);
    }

    [Fact]
    public async Task Idempotency_key_reuse_is_422()
    {
        var (http, problem) = await HandleAsync(new IdempotencyKeyReuseException());

        http.Response.StatusCode.ShouldBe(422);
        problem.Type.ShouldBe(ProblemTypes.IdempotencyKeyReuse);
        problem.Title.ShouldBe("Idempotency key reused");
        problem.Detail.ShouldBe("The Idempotency-Key was already used with a different request.");
    }

    [Fact]
    public async Task Stale_row_version_is_409_concurrency_conflict()
    {
        var (http, problem) = await HandleAsync(new DbUpdateConcurrencyException("Database operation expected to affect 1 row(s) but actually affected 0 row(s)."));

        http.Response.StatusCode.ShouldBe(409);
        problem.Type.ShouldBe(ProblemTypes.ConcurrencyConflict);
        problem.Title.ShouldBe("Concurrency conflict");
        problem.Detail.ShouldNotBeNull().ShouldNotContain("row(s)");
    }

    [Fact]
    public async Task Unreadable_request_is_400_validation_error_without_framework_text()
    {
        var (http, problem) = await HandleAsync(new BadHttpRequestException("Failed to read parameter \"BookAppointmentRequest request\" from the request body as JSON.", 400));

        http.Response.StatusCode.ShouldBe(400);
        problem.Type.ShouldBe(ProblemTypes.ValidationError);
        problem.Title.ShouldBe("Validation failed");
        problem.Detail.ShouldNotBeNull().ShouldNotContain("BookAppointmentRequest");
    }

    [Fact]
    public async Task Other_bad_request_statuses_are_kept()
    {
        var (http, problem) = await HandleAsync(new BadHttpRequestException("Request body too large. The max request body size is 65536 bytes.", 413));

        http.Response.StatusCode.ShouldBe(413);
        problem.Status.ShouldBe(413);
        problem.Type.ShouldBeNull(); // the framework's default for the status code is applied when the problem is written
        problem.Detail.ShouldBeNull();
    }

    [Fact]
    public async Task Aborted_request_is_499_without_a_body()
    {
        var http = Request();
        http.RequestAborted = new CancellationToken(canceled: true);

        (await Handler.TryHandleAsync(http, new OperationCanceledException(), CancellationToken.None)).ShouldBeTrue();

        http.Response.StatusCode.ShouldBe(499);
        _problems.Written.ShouldBeEmpty();
        _logger.Entries.ShouldBeEmpty();
    }

    [Fact]
    public async Task Cancellation_the_client_did_not_ask_for_is_an_unexpected_500()
    {
        var (http, problem) = await HandleAsync(new OperationCanceledException("A server-side timeout."));

        http.Response.StatusCode.ShouldBe(500);
        problem.Type.ShouldBe(ProblemTypes.InternalError);
        _logger.Entries.ShouldHaveSingleItem().EventId.Id.ShouldBe(1200);
    }

    [Fact]
    public async Task Unexpected_exception_is_500_without_details_and_logged_with_the_exception()
    {
        var exception = new InvalidOperationException("Host=db;Password=hunter2 exploded");

        var (http, problem) = await HandleAsync(exception);

        http.Response.StatusCode.ShouldBe(500);
        problem.Type.ShouldBe("https://api.keyloop.example/problems/internal-error");
        problem.Title.ShouldBe("Internal server error");
        problem.Detail.ShouldBe("An unexpected error occurred.");
        problem.Instance.ShouldBe(Path);
        problem.Extensions.ShouldBeEmpty(); // traceId is added when the problem is written

        var entry = _logger.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Error);
        entry.EventId.ShouldBe(new EventId(1200, "UnhandledException"));
        entry.Exception.ShouldBeSameAs(exception);
        entry.Message.ShouldContain($"POST {Path}");
    }

    [Fact]
    public async Task Client_that_does_not_accept_json_still_gets_the_mapped_status()
    {
        var http = Request();
        _problems.Accepts = false;

        (await Handler.TryHandleAsync(http, new IdempotencyKeyReuseException(), CancellationToken.None)).ShouldBeTrue();

        http.Response.StatusCode.ShouldBe(422);
    }

    private GlobalExceptionHandler Handler => new(_problems, _logger);

    private static DefaultHttpContext Request()
    {
        var http = new DefaultHttpContext();
        http.Request.Method = "POST";
        http.Request.Path = Path;
        return http;
    }

    private async Task<(HttpContext Http, ProblemDetails Problem)> HandleAsync(Exception exception)
    {
        var http = Request();
        (await Handler.TryHandleAsync(http, exception, CancellationToken.None)).ShouldBeTrue();
        var written = _problems.Written.ShouldHaveSingleItem();
        written.HttpContext.ShouldBeSameAs(http);
        _problems.Written.Clear();
        return (http, written.ProblemDetails);
    }

    private sealed class RecordingProblemDetailsService : IProblemDetailsService
    {
        public List<ProblemDetailsContext> Written { get; } = [];

        /// <summary>False simulates a request whose Accept header excludes JSON: the real service then writes nothing.</summary>
        public bool Accepts { get; set; } = true;

        public ValueTask WriteAsync(ProblemDetailsContext context)
        {
            Written.Add(context);
            return ValueTask.CompletedTask;
        }

        public async ValueTask<bool> TryWriteAsync(ProblemDetailsContext context)
        {
            if (!Accepts)
            {
                return false;
            }

            await WriteAsync(context);
            return true;
        }
    }
}

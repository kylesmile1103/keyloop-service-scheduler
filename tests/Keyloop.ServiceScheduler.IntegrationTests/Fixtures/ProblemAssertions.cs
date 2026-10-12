using System.Net;
using System.Text.Json;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Assertions for RFC 9457 responses from the catalogue (ARCHITECTURE §8.7).</summary>
public static class ProblemAssertions
{
    public const string TypeBase = "https://api.keyloop.example/problems/";

    /// <summary>
    /// Asserts <paramref name="status"/>, <c>application/problem+json</c>, <c>type</c> = <see cref="TypeBase"/> + <paramref name="slug"/>, a
    /// title, a W3C <c>traceId</c> and <c>instance</c> = the request path; returns the problem's root (detached from the document).
    /// </summary>
    public static async Task<JsonElement> ShouldBeProblemAsync(this HttpResponseMessage response, HttpStatusCode status, string slug, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(response);
        var body = await response.Content.ReadAsStringAsync(ct);
        response.StatusCode.ShouldBe(status, body);
        using var document = await response.ReadProblemAsync(ct);
        var problem = document.RootElement.Clone();
        problem.GetProperty("type").GetString().ShouldBe(TypeBase + slug, body);
        problem.GetProperty("status").GetInt32().ShouldBe((int)status);
        problem.GetProperty("title").GetString().ShouldNotBeNullOrWhiteSpace();
        problem.GetProperty("traceId").GetString().ShouldNotBeNull().ShouldMatch("^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$");
        problem.GetProperty("instance").GetString().ShouldBe(response.RequestMessage?.RequestUri?.AbsolutePath);
        return problem;
    }

    /// <summary>Asserts a 400 <c>validation-error</c> whose <c>errors</c> has exactly <paramref name="errorKeys"/> (in any order).</summary>
    public static async Task<JsonElement> ShouldBeValidationErrorAsync(this HttpResponseMessage response, string[] errorKeys, CancellationToken ct)
    {
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation-error", ct);
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).ShouldBe(errorKeys, ignoreOrder: true);
        return problem;
    }
}

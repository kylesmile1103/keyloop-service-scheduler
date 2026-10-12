using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Keyloop.ServiceScheduler.UnitTests.TestSupport;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

/// <summary>
/// The production path: <c>Triage:ImageStoreUrl=http://triage-media.internal</c>, the Container's private R2 relay. In production the
/// relay accepts any 32-hex dealership segment, so dealership scoping and the read-side expiry check live only in this class.
/// </summary>
public sealed class TriageImageStoreTests : IDisposable
{
    private const string Relay = "http://triage-media.internal";
    private static readonly Guid DealershipA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DealershipB = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ImageId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero));
    private readonly RelayStub _relay = new();
    private readonly CapturingLogger<TriageImageStore> _logger = new();
    private readonly HttpClient _http;
    private readonly byte[] _png = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Triage", "Fixtures", "plain-3x2.png"));

    public TriageImageStoreTests() => _http = new HttpClient(_relay);

    public void Dispose()
    {
        _http.Dispose();
        _relay.Dispose();
    }

    private TriageImageStore Store(string url = Relay, bool imagesEnabled = true) => new(_http,
        Options.Create(new TriageConnectionOptions { Enabled = true, ImagesEnabled = imagesEnabled, ImageStoreUrl = url }),
        new TransientTriageImages(_clock), _clock, _logger);

    private StoredTriageImage Png() => new("image/png", _png, _clock.GetUtcNow().Add(TriageImageLimits.Lifetime));

    [Fact]
    public async Task Put_sends_the_bytes_type_and_expiry_to_the_dealership_scoped_relay_key()
    {
        var image = Png();
        await Store().PutAsync(DealershipA, ImageId, image, TestContext.Current.CancellationToken);
        var put = _relay.Requests.ShouldHaveSingleItem();
        put.Method.ShouldBe(HttpMethod.Put);
        put.Uri.ShouldBe(new Uri($"{Relay}/triage/{DealershipA:N}/{ImageId:N}"));
        put.ContentType.ShouldBe("image/png");
        put.Expires.ShouldBe(image.ExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        put.Body.ShouldBe(_png);
    }

    [Fact]
    public async Task An_upload_is_readable_only_under_the_dealership_it_was_stored_for()
    {
        var store = Store();
        await store.PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken);
        var read = await store.GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken);
        read.ShouldNotBeNull().Bytes.ShouldBe(_png);
        read.ContentType.ShouldBe("image/png");
        (await store.GetAsync(DealershipB, ImageId, TestContext.Current.CancellationToken)).ShouldBeNull();
        _relay.Requests[^1].Uri.AbsolutePath.ShouldBe($"/triage/{DealershipB:N}/{ImageId:N}");
    }

    [Fact]
    public async Task A_missing_object_is_null()
    {
        (await Store().GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken)).ShouldBeNull();
        _logger.Entries.ShouldBeEmpty();
    }

    [Theory]
    [InlineData(0)]     // expires exactly now
    [InlineData(-1)]
    public async Task An_object_at_or_past_its_expiry_is_null_even_when_the_relay_still_returns_it(int secondsFromNow)
    {
        var store = Store();
        await store.PutAsync(DealershipA, ImageId, Png() with { ExpiresAt = _clock.GetUtcNow().AddSeconds(secondsFromNow) },
            TestContext.Current.CancellationToken);
        (await store.GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken)).ShouldBeNull();
    }

    [Fact]
    public async Task An_object_one_second_before_expiry_is_returned()
    {
        var store = Store();
        await store.PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken);
        _clock.Advance(TriageImageLimits.Lifetime - TimeSpan.FromSeconds(1));
        (await store.GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken)).ShouldNotBeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("soon")]
    [InlineData("-1")]
    [InlineData("1791792000,1791792000")]
    [InlineData("253402300800")]   // after 9999-12-31
    public async Task A_missing_or_malformed_expiry_fails_closed_as_image_storage(string? expires)
    {
        _relay.Objects[$"/triage/{DealershipA:N}/{ImageId:N}"] = new("image/png", _png, expires);
        await ShouldBeUnavailableAsync(() => Store().GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken), "image-storage");
    }

    [Theory]
    [InlineData("image/jpeg")]
    [InlineData("application/octet-stream")]
    [InlineData(null)]
    public async Task Stored_bytes_that_do_not_match_their_type_fail_closed_as_image_storage(string? type)
    {
        _relay.Objects[$"/triage/{DealershipA:N}/{ImageId:N}"] = new(type, _png, Expiry(TriageImageLimits.Lifetime));
        await ShouldBeUnavailableAsync(() => Store().GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken), "image-storage");
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge)]
    public async Task A_relay_refusal_is_image_storage_for_both_put_and_get(HttpStatusCode status)
    {
        _relay.Status = status;
        await ShouldBeUnavailableAsync(() => Store().PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken), "image-storage");
        await ShouldBeUnavailableAsync(() => Store().GetAsync(DealershipA, ImageId, TestContext.Current.CancellationToken), "image-storage");
    }

    [Fact]
    public async Task A_transport_failure_is_image_storage_and_logs_no_url_bytes_or_exception_text()
    {
        _relay.Failure = new HttpRequestException($"connection refused for {Relay}/triage/{DealershipA:N}/{ImageId:N}");
        await ShouldBeUnavailableAsync(() => Store().PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken), "image-storage");
        var entry = _logger.Entries.ShouldHaveSingleItem();
        entry.Exception.ShouldBeNull();
        entry.Message.ShouldNotContain(DealershipA.ToString("N"));
        entry.Message.ShouldNotContain(ImageId.ToString("N"));
        entry.Message.ShouldNotContain("connection refused");
    }

    [Fact]
    public async Task Disabled_images_are_refused_before_any_relay_call_as_configuration_not_a_logged_failure()
    {
        // Like disabled text triage, disabled images are a published configuration state (GET /booking-triage), not an outage.
        var error = await Should.ThrowAsync<TriageUnavailableException>(() =>
            Store(imagesEnabled: false).PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken));
        error.Reason.ShouldBe("images-disabled");
        _relay.Requests.ShouldBeEmpty();
        _logger.Entries.ShouldBeEmpty();
    }

    [Fact]
    public async Task Reading_for_evaluation_returns_every_scoped_image_in_order()
    {
        var store = Store();
        var second = Guid.NewGuid();
        await store.PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken);
        await store.PutAsync(DealershipA, second, Png(), TestContext.Current.CancellationToken);
        var images = await store.ReadForEvaluationAsync(DealershipA, [second, ImageId], TestContext.Current.CancellationToken);
        images.Count.ShouldBe(2);
        _relay.Requests.Where(r => r.Method == HttpMethod.Get).Select(r => r.Uri.AbsolutePath)
            .ShouldBe([$"/triage/{DealershipA:N}/{second:N}", $"/triage/{DealershipA:N}/{ImageId:N}"]);
    }

    [Fact]
    public async Task Reading_for_evaluation_rejects_an_image_of_another_dealership_as_an_imageIds_input_error()
    {
        var store = Store();
        await store.PutAsync(DealershipA, ImageId, Png(), TestContext.Current.CancellationToken);
        var error = await Should.ThrowAsync<TriageInputException>(() =>
            store.ReadForEvaluationAsync(DealershipB, [ImageId], TestContext.Current.CancellationToken));
        error.Field.ShouldBe("imageIds");
    }

    [Fact]
    public async Task Reading_for_evaluation_past_the_storage_deadline_is_logged_image_storage()
    {
        _relay.Hang = true;
        var store = Store();
        var reading = store.ReadForEvaluationAsync(DealershipA, [ImageId], TestContext.Current.CancellationToken);
        await _relay.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        _clock.Advance(TriageImageLimits.ReadDeadline);
        var error = await Should.ThrowAsync<TriageUnavailableException>(() => reading);
        error.Reason.ShouldBe("image-storage");
        _logger.Entries.ShouldHaveSingleItem().EventId.Id.ShouldBe(1400);
    }

    [Fact]
    public async Task A_full_local_store_is_logged_image_capacity()
    {
        var store = Store(url: "");
        var big = new StoredTriageImage("image/png", new byte[TriageImageLimits.MaxImageBytes], _clock.GetUtcNow().AddHours(1));
        for (var i = 0; i < 16; i++)
        {
            await store.PutAsync(DealershipA, Guid.NewGuid(), big, TestContext.Current.CancellationToken);
        }

        await ShouldBeUnavailableAsync(() => store.PutAsync(DealershipA, Guid.NewGuid(), big, TestContext.Current.CancellationToken), "image-capacity");
        _relay.Requests.ShouldBeEmpty();
    }

    private string Expiry(TimeSpan fromNow) =>
        _clock.GetUtcNow().Add(fromNow).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);

    private async Task ShouldBeUnavailableAsync(Func<Task> action, string reason)
    {
        var before = _logger.Entries.Count;
        var error = await Should.ThrowAsync<TriageUnavailableException>(action);
        error.Reason.ShouldBe(reason);
        var logged = _logger.Entries.Skip(before).ShouldHaveSingleItem();
        logged.EventId.Id.ShouldBe(1400);
        logged.Level.ShouldBe(LogLevel.Warning);
        logged.Message.ShouldContain(reason);
    }

    private sealed record StoredObject(string? ContentType, byte[] Bytes, string? Expires);

    private sealed record Captured(HttpMethod Method, Uri Uri, string? ContentType, string? Expires, byte[] Body);

    /// <summary>Behaves like deploy/cloudflare/src/triage-media.ts: objects keyed by path, expiry returned as stored.</summary>
    private sealed class RelayStub : HttpMessageHandler
    {
        public Dictionary<string, StoredObject> Objects { get; } = new(StringComparer.Ordinal);
        public List<Captured> Requests { get; } = [];
        public HttpStatusCode? Status { get; set; }
        public Exception? Failure { get; set; }
        public bool Hang { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            Requests.Add(new(request.Method, request.RequestUri!, request.Content?.Headers.ContentType?.MediaType,
                request.Headers.TryGetValues("x-upload-expires", out var values) ? string.Join(",", values) : null, body));
            Started.TrySetResult();
            if (Hang)
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }

            if (Failure is not null)
            {
                throw Failure;
            }

            if (Status is { } status)
            {
                return new HttpResponseMessage(status);
            }

            var key = request.RequestUri!.AbsolutePath;
            if (request.Method == HttpMethod.Put)
            {
                Objects[key] = new(request.Content!.Headers.ContentType?.MediaType, body, Requests[^1].Expires);
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }

            if (!Objects.TryGetValue(key, out var stored))
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }

            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(stored.Bytes) };
            if (stored.ContentType is not null)
            {
                response.Content.Headers.ContentType = new MediaTypeHeaderValue(stored.ContentType);
            }

            if (stored.Expires is not null)
            {
                response.Headers.TryAddWithoutValidation("x-upload-expires", stored.Expires.Split(','));
            }

            return response;
        }
    }
}

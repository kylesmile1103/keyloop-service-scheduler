using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Keyloop.ServiceScheduler.IntegrationTests.Fixtures;

/// <summary>Loopback OTLP/HTTP receiver that records exported paths, headers, and protobuf payloads.</summary>
public sealed class OtlpReceiver : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly ConcurrentQueue<Export> _exports = new();

    private OtlpReceiver(WebApplication app) => _app = app;

    /// <summary>The OTEL_EXPORTER_OTLP_ENDPOINT base, shaped like the gateway's <c>https://otlp-gateway-&lt;region&gt;.grafana.net/otlp</c>.</summary>
    public string Endpoint { get; private set; } = "";

    public IReadOnlyList<Export> Exports => [.. _exports];

    public static async Task<OtlpReceiver> StartAsync(CancellationToken cancellationToken)
    {
        var builder = WebApplication.CreateEmptyBuilder(new WebApplicationOptions());
        builder.WebHost.UseKestrelCore().ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, 0));
        var app = builder.Build();
        var receiver = new OtlpReceiver(app);
        app.Run(async context =>
        {
            using var body = new MemoryStream();
            await context.Request.Body.CopyToAsync(body, context.RequestAborted);
            receiver._exports.Enqueue(new Export(context.Request.Path.Value ?? "", context.Request.Headers.Authorization.ToString(),
                context.Request.ContentType ?? "", body.ToArray()));
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.ContentType = "application/x-protobuf";
        });
        await app.StartAsync(cancellationToken);
        var address = app.Services.GetRequiredService<IServer>().Features.GetRequiredFeature<IServerAddressesFeature>().Addresses.Single();
        receiver.Endpoint = $"{address}/otlp";
        return receiver;
    }

    /// <summary>Waits until at least one export has arrived on each of the given paths.</summary>
    public async Task WaitForPathsAsync(IReadOnlyCollection<string> paths, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!paths.All(path => _exports.Any(export => export.Path == path)))
        {
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException(
                    $"Expected exports on {string.Join(", ", paths)}; received {string.Join(", ", _exports.Select(export => export.Path).Distinct())}.");
            }

            await Task.Delay(TimeSpan.FromMilliseconds(100), cancellationToken);
        }
    }

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();

    public sealed record Export(string Path, string Authorization, string ContentType, byte[] Body)
    {
        /// <summary>Extracts string resource attributes from an OTLP Export{Traces,Metrics,Logs}ServiceRequest protobuf payload.</summary>
        public IReadOnlyDictionary<string, string> ResourceAttributes()
        {
            var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var entry in LengthDelimited(Body, 1))
            {
                foreach (var resource in LengthDelimited(entry, 1))
                {
                    foreach (var keyValue in LengthDelimited(resource, 1))
                    {
                        var key = Encoding.UTF8.GetString(LengthDelimited(keyValue, 1).Single());
                        if (LengthDelimited(LengthDelimited(keyValue, 2).Single(), 1).SingleOrDefault() is { } text)
                        {
                            attributes[key] = Encoding.UTF8.GetString(text);
                        }
                    }
                }
            }

            return attributes;
        }

        private static List<byte[]> LengthDelimited(byte[] message, int fieldNumber)
        {
            var fields = new List<byte[]>();
            var position = 0;
            while (position < message.Length)
            {
                var tag = ReadVarint(message, ref position);
                switch (tag & 7)
                {
                    case 0:
                        ReadVarint(message, ref position);
                        break;
                    case 1:
                        position += 8;
                        break;
                    case 2:
                        var length = checked((int)ReadVarint(message, ref position));
                        if ((int)(tag >> 3) == fieldNumber)
                        {
                            fields.Add(message[position..(position + length)]);
                        }

                        position += length;
                        break;
                    case 5:
                        position += 4;
                        break;
                    default:
                        throw new InvalidDataException($"Unsupported protobuf wire type in tag {tag}.");
                }
            }

            return fields;
        }

        private static ulong ReadVarint(byte[] data, ref int position)
        {
            ulong value = 0;
            for (var shift = 0; shift < 64; shift += 7)
            {
                var current = data[position++];
                value |= (ulong)(current & 0x7F) << shift;
                if ((current & 0x80) == 0)
                {
                    return value;
                }
            }

            throw new InvalidDataException("Malformed protobuf varint.");
        }
    }
}

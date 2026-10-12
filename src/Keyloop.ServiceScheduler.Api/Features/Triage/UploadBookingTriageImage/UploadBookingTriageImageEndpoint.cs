using System.ComponentModel;
using FluentValidation;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.UploadBookingTriageImage;

/// <summary>A PNG, JPEG or WebP image. Original filenames are never sent or stored.</summary>
/// <param name="ContentType">image/png, image/jpeg or image/webp. The file's signature and header must match it.</param>
/// <param name="Base64">Standard base64 of the whole file: 1 byte to 4 MiB decoded (at most 5,592,408 characters) and at most 16 megapixels.</param>
public sealed record UploadBookingTriageImageRequest(string ContentType, string Base64);

/// <summary>A private, dealership-scoped upload reference usable for triage until expiry.</summary>
/// <param name="ImageId">Opaque reference for TriageBookingRequest imageIds, valid only for this dealership until expiresAt.</param>
/// <param name="ContentType">The validated type: image/png, image/jpeg or image/webp.</param>
/// <param name="SizeBytes">Decoded bytes stored.</param>
/// <param name="ExpiresAt">One hour after upload. Later evaluations treat the reference as missing; storage deletes it within about an hour more.</param>
public sealed record UploadBookingTriageImageResponse(Guid ImageId, string ContentType, int SizeBytes, DateTimeOffset ExpiresAt);

public sealed class UploadBookingTriageImageValidator : AbstractValidator<UploadBookingTriageImageRequest>
{
    public UploadBookingTriageImageValidator()
    {
        RuleFor(r => r.ContentType).Must(type => type is "image/png" or "image/jpeg" or "image/webp")
            .WithMessage("Choose a PNG, JPEG or WebP image.");
        RuleFor(r => r.Base64).NotEmpty().MaximumLength(4 * ((TriageImageLimits.MaxImageBytes + 2) / 3))
            .WithMessage("Each image must contain 1 byte to 4 MiB.");
    }
}

public sealed class UploadBookingTriageImageHandler(SchedulerDbContext db, TriageImageStore store,
    IOptions<TriageConnectionOptions> options, TimeProvider clock)
{
    public async Task<UploadBookingTriageImageResponse> HandleAsync(Guid dealershipId, UploadBookingTriageImageRequest request, CancellationToken ct)
    {
        if (!options.Value.Enabled || !options.Value.ImagesEnabled)
        {
            throw new TriageUnavailableException("images-disabled");
        }

        if (!await db.Dealerships.AnyAsync(d => d.Id == dealershipId, ct))
        {
            throw new NotFoundException("dealership", dealershipId);
        }

        var bytes = TriageImageValidator.Decode(request.ContentType, request.Base64);
        var id = Guid.NewGuid();
        var expires = clock.GetUtcNow().Add(TriageImageLimits.Lifetime);
        await store.PutAsync(dealershipId, id, new(request.ContentType, bytes, expires), ct);
        return new(id, request.ContentType, bytes.Length, expires);
    }
}

/// <summary>Marks the only route allowed to read a body larger than the API's ordinary 64 KiB cap.</summary>
public sealed record TriageImageBodyLimit;

public sealed class UploadBookingTriageImageEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapPost("/dealerships/{dealershipId:guid}/booking-triage/images", HandleAsync)
        .WithName("UploadBookingTriageImage").WithTags(ApiTags.Catalog)
        .WithMetadata(new TriageImageBodyLimit())
        .RequireAuthorization(SchedulerAuthentication.BookingsWrite)
        .ProducesProblem(StatusCodes.Status401Unauthorized)
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .RequireRateLimiting(SchedulerRateLimiting.TriagePolicy)
        .AddEndpointFilter<ValidationFilter<UploadBookingTriageImageRequest>>()
        .Produces<UploadBookingTriageImageResponse>().ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status413PayloadTooLarge)
        .ProducesRateLimitedProblem().ProducesProblem(StatusCodes.Status503ServiceUnavailable);

    /// <summary>Upload a private photo for booking intake triage</summary>
    /// <remarks>Uploads expire after one hour. No public download URL, filename or booking attachment is created.</remarks>
    /// <param name="dealershipId">Dealership that can use this upload reference.</param>
    /// <param name="request">Image type and base64-encoded bytes.</param>
    /// <param name="handler">Validates and stores the bounded image.</param>
    /// <param name="context">Sets no-store on the upload response.</param>
    /// <param name="ct">Cancelled when the client disconnects.</param>
    /// <response code="200">Opaque image ID, type, byte count and expiry.</response>
    /// <response code="400">Invalid image type, encoding, dimensions or size (validation-error).</response>
    /// <response code="404">No dealership has this id (not-found).</response>
    /// <response code="401">Sign-in required (<c>unauthenticated</c>, with <c>loginUrl</c>).</response>
    /// <response code="403">The caller's role does not permit this operation (<c>forbidden</c>).</response>
    /// <response code="413">Upload request exceeds the six MiB JSON body limit.</response>
    /// <response code="429">Too many uploads or evaluations from this client; retry after Retry-After.</response>
    /// <response code="503">Image triage is disabled or private storage is unavailable.</response>
    internal static async Task<Ok<UploadBookingTriageImageResponse>> HandleAsync(Guid dealershipId,
        [Description("A PNG, JPEG or WebP image: contentType and base64 bytes, at most four MiB decoded and 16 megapixels.")] UploadBookingTriageImageRequest request,
        [FromServices] UploadBookingTriageImageHandler handler, HttpContext context, CancellationToken ct)
    {
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.Ok(await handler.HandleAsync(dealershipId, request, ct));
    }
}

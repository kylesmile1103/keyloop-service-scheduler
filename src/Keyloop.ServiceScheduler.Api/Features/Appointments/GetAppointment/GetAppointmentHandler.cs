using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.GetAppointment;

/// <summary>
/// One appointment in any status, with its service, bay, technician and local times (<see cref="AppointmentResponseQuery"/>). Throws
/// <see cref="NotFoundException"/> (404 <c>not-found</c>, <c>resource</c> = <c>appointment</c>) for an unknown id.
/// </summary>
public sealed class GetAppointmentHandler(SchedulerDbContext db, Microsoft.Extensions.Options.IOptions<Common.Options.SchedulingOptions> options)
{
    public async Task<AppointmentResponse> HandleAsync(Guid appointmentId, CancellationToken ct) =>
        await AppointmentResponseQuery.FindAsync(db, appointmentId, ct, options.Value.VehicleAwareRequirements)
        ?? throw new NotFoundException(ProblemResources.Appointment, appointmentId);
}

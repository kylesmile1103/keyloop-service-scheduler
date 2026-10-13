using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.GetAppointment;

/// <summary>Loads a single appointment by ID or throws <see cref="NotFoundException"/>.</summary>
public sealed class GetAppointmentHandler(SchedulerDbContext db, Microsoft.Extensions.Options.IOptions<Common.Options.SchedulingOptions> options)
{
    public async Task<AppointmentResponse> HandleAsync(Guid appointmentId, CancellationToken ct) =>
        await AppointmentResponseQuery.FindAsync(db, appointmentId, ct, options.Value.VehicleAwareRequirements)
        ?? throw new NotFoundException(ProblemResources.Appointment, appointmentId);
}

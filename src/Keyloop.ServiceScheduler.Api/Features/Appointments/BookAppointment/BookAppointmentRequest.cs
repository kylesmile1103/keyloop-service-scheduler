using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;

// The request records declare their properties explicitly (initialised from the positional parameters) because the OpenAPI XML
// comment generator copies a record's <param> descriptions onto its properties but not their examples: an <example> on the property
// itself is what reaches the schema (as JSON Schema `examples`), and Scalar's "Test request" body is built from those (Addendum B §B2).
// Optional members have defaults, so they are not `required` in the schema either.

/// <summary>
/// The body of <c>POST /dealerships/{dealershipId}/appointments</c>: one service at one start time for one customer's vehicle. The
/// examples form a valid booking at the seeded Keyloop Motors Reading dealership.
/// </summary>
public sealed record BookAppointmentRequest(
    Guid ServiceTypeId,
    DateTime StartUtc,
    CustomerRequest Customer,
    VehicleRequest Vehicle,
    Guid? PreferredBayId = null,
    Guid? PreferredTechnicianId = null,
    string? Notes = null)
{
    /// <summary>The service to book, from the catalogue (the example is the seeded Interim Service).</summary>
    /// <example>3153f30d-5700-8f07-a25d-4a4ea44dfeef</example>
    public Guid ServiceTypeId { get; init; } = ServiceTypeId;

    /// <summary>
    /// Start time in UTC with <c>Z</c> and no seconds: a start offered by the availability route, inside the dealership's opening hours,
    /// on its slot grid, and between the minimum lead time and the booking horizon from now.
    /// </summary>
    /// <example>2026-10-13T09:00:00Z</example>
    public DateTime StartUtc { get; init; } = StartUtc;

    /// <summary>Who the appointment is for.</summary>
    public CustomerRequest Customer { get; init; } = Customer;

    /// <summary>The vehicle to be serviced.</summary>
    public VehicleRequest Vehicle { get; init; } = Vehicle;

    /// <summary>
    /// Optional: a bay to use when it is free and can host the service; otherwise the hint is ignored and the allocation policy
    /// chooses (the example is the seeded Reading Bay 1 - Standard).
    /// </summary>
    /// <example>29c9f970-e13d-879e-a949-a553839cf25e</example>
    public Guid? PreferredBayId { get; init; } = PreferredBayId;

    /// <summary>Optional: a technician to assign when free and certified; otherwise ignored (the example is the seeded Amelia Clarke at Reading).</summary>
    /// <example>bd559b63-ceea-83dd-9a48-f2bc7a515dcd</example>
    public Guid? PreferredTechnicianId { get; init; } = PreferredTechnicianId;

    /// <summary>Optional free text for the workshop, at most 1000 characters after trimming.</summary>
    /// <example>Customer reports a rattle from the front left wheel.</example>
    public string? Notes { get; init; } = Notes;
}

/// <summary>The customer's contact details.</summary>
public sealed record CustomerRequest(string Name, string Email, string Phone)
{
    /// <summary>Full name, 1 to 120 characters after trimming.</summary>
    /// <example>Alex Morgan</example>
    public string Name { get; init; } = Name;

    /// <summary>Email address, at most 254 characters.</summary>
    /// <example>alex.morgan@example.com</example>
    public string Email { get; init; } = Email;

    /// <summary>Phone number, 3 to 40 characters of digits, spaces and <c>+ ( ) -</c>.</summary>
    /// <example>+44 7700 900123</example>
    public string Phone { get; init; } = Phone;
}

/// <summary>The vehicle to be serviced.</summary>
public sealed record VehicleRequest(string Vin, string Registration, string Make, string Model)
{
    /// <summary>Vehicle identification number: 17 characters, digits and letters other than I, O and Q (case-insensitive).</summary>
    /// <example>WVWZZZ1KZAW123456</example>
    public string Vin { get; init; } = Vin;

    /// <summary>Registration plate, 1 to 16 characters; stored upper case.</summary>
    /// <example>AB12 CDE</example>
    public string Registration { get; init; } = Registration;

    /// <summary>Manufacturer, 1 to 60 characters.</summary>
    /// <example>Volkswagen</example>
    public string Make { get; init; } = Make;

    /// <summary>Model, 1 to 60 characters.</summary>
    /// <example>Golf</example>
    public string Model { get; init; } = Model;
}

/// <summary>A validated booking request for a dealership, with the client's optional <c>Idempotency-Key</c>.</summary>
public sealed record BookAppointmentCommand(Guid DealershipId, BookAppointmentRequest Request, string? IdempotencyKey);

/// <summary>The booked appointment; <see cref="Replayed"/> when it is the stored response of an earlier request with the same key.</summary>
public sealed record BookAppointmentResult(AppointmentResponse Appointment, bool Replayed);

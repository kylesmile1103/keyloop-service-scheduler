namespace Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;

/// <summary>Intake fields from the most recent booking of a customer-and-vehicle pair; no booking free text or profile.</summary>
/// <param name="Customer">Name and contact details as supplied on that booking.</param>
/// <param name="Vehicle">Only the vehicle intake identifiers, make and model.</param>
/// <param name="LastVisitUtc">The most recent booking's start UTC, across every status.</param>
/// <param name="Visits">Number of this dealership's bookings with the same case-insensitive email and VIN, across every status.</param>
public sealed record ReturningCustomerResponse(ReturningCustomerDetails Customer, ReturningVehicleDetails Vehicle, DateTime LastVisitUtc, long Visits);

/// <summary>Customer intake details, visible only to staff authorized to book.</summary>
public sealed record ReturningCustomerDetails(string Name, string Email, string Phone);

/// <summary>Vehicle intake fields only; no profile, provenance or allocation requirements.</summary>
public sealed record ReturningVehicleDetails(string Vin, string Registration, string Make, string Model);

using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public sealed record CustomerDetails
{
    public CustomerDetails(string name, string email, string phone)
    {
        Name = Guard.Required(name, 1, 120, nameof(name));
        Email = Guard.Required(email, 3, 254, nameof(email));
        Phone = Guard.Required(phone, 3, 40, nameof(phone));
    }

    public string Name { get; }

    public string Email { get; }

    public string Phone { get; }
}

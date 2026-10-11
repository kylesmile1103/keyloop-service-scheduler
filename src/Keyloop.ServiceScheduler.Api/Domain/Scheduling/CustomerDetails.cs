namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

public sealed record CustomerDetails
{
    public CustomerDetails(string name, string email, string phone)
    {
        Name = Text.Required(name, 1, 120, nameof(name));
        Email = Text.Required(email, 3, 254, nameof(email));
        Phone = Text.Required(phone, 3, 40, nameof(phone));
    }

    public string Name { get; }

    public string Email { get; }

    public string Phone { get; }
}

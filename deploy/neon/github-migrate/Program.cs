using System.Diagnostics;
using Npgsql;

// Use Npgsql's parser, including quoted passwords, rather than rewriting a keyword string as a URI in shell.
// Child output is withheld: either tool can include connection details in an error. Never print the exception.
try
{
    var owner = new NpgsqlConnectionStringBuilder(
        Environment.GetEnvironmentVariable("NEON_OWNER_CONNECTION")
        ?? throw new InvalidOperationException());
    if (owner.SslMode != SslMode.VerifyFull || owner.ChannelBinding != ChannelBinding.Require
        || string.IsNullOrWhiteSpace(owner.Host) || owner.Host.Contains("-pooler", StringComparison.OrdinalIgnoreCase)
        || owner.Host.Contains(',') || string.IsNullOrWhiteSpace(owner.Database)
        || string.IsNullOrWhiteSpace(owner.Username) || string.IsNullOrEmpty(owner.Password))
    {
        throw new InvalidOperationException();
    }

    if (args is ["--validate-only"])
    {
        Console.WriteLine("Owner connection validated: Npgsql keywords, direct host, verified TLS and required channel binding.");
        return 0;
    }
    if (args.Length != 2)
    {
        throw new InvalidOperationException();
    }

    var bundle = new ProcessStartInfo(Path.GetFullPath(args[0]));
    bundle.ArgumentList.Add("--connection");
    bundle.ArgumentList.Add(owner.ConnectionString);
    await RunAsync(bundle);
    Console.WriteLine("Migration bundle completed; only pending migrations were applied.");

    var grants = new ProcessStartInfo("psql");
    foreach (var argument in new[] { "--no-psqlrc", "--no-password", "-v", "ON_ERROR_STOP=1", "-f", Path.GetFullPath(args[1]) })
    {
        grants.ArgumentList.Add(argument);
    }
    grants.Environment["PGHOST"] = owner.Host;
    grants.Environment["PGPORT"] = owner.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
    grants.Environment["PGDATABASE"] = owner.Database;
    grants.Environment["PGUSER"] = owner.Username;
    grants.Environment["PGPASSWORD"] = owner.Password;
    grants.Environment["PGSSLMODE"] = "verify-full";
    grants.Environment["PGSSLROOTCERT"] = "system";
    grants.Environment["PGCHANNELBINDING"] = "require";
    await RunAsync(grants);
    // Check the postcondition independently of the grant script, including forbidden audit/appointment privileges.
    grants.ArgumentList[^1] = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1]))!, "verify-runtime-role.sql");
    await RunAsync(grants);
    Console.WriteLine("Idempotent runtime-role grants applied and verified.");
    return 0;
}
catch
{
    Console.Error.WriteLine("Neon migration/grant step failed. Check the owner connection, pending migration and runtime-role prerequisites; tool output withheld to protect credentials.");
    return 1;
}

static async Task RunAsync(ProcessStartInfo start)
{
    start.UseShellExecute = false;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;
    using var process = Process.Start(start) ?? throw new InvalidOperationException();
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    await Task.WhenAll(stdout, stderr);
    if (process.ExitCode != 0)
    {
        throw new InvalidOperationException();
    }
}

export async function requiredSecret(binding: Pick<SecretsStoreSecret, "get"> | undefined, name: string): Promise<string> {
  // Provider exceptions can contain credentials. Never retain their message or cause.
  try {
    const value = await binding?.get();
    if (value?.trim()) return value;
  } catch {
    // Use the same sanitised failure for unavailable and missing secrets.
  }
  throw new Error(`Secrets Store secret ${name} is unavailable`);
}

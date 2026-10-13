import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function currentImage(instances, image) {
  assert.ok(Array.isArray(instances), "Expected the cf instance-list JSON array");
  // One active instance is configured. Do not accept an old running placement alongside a new one.
  return instances.length > 0 && instances.every(instance => instance.status?.state === "running"
    && (instance.image === image || (instance.image?.startsWith(`${image}@sha256:`)
      && /^[a-f0-9]{64}$/.test(instance.image.slice(instance.image.lastIndexOf(":") + 1)))));
}

export function maskedSchedule(schedule) {
  assert.ok(Array.isArray(schedule.bays), "Expected a schedule with bays");
  const appointments = schedule.bays.flatMap(bay => bay.appointments);
  if (appointments.length === 0) return false;
  for (const appointment of appointments) {
    assert.match(appointment.customerName, /^[\p{Lu}\p{Lt}]+$/u, "Customer name is not initials");
    assert.match(appointment.vin, /^\*{11}[A-HJ-NPR-Z0-9]{6}$/, "VIN is not masked");
    assert.equal(appointment.registration, "*******", "Registration is not masked");
  }
  // Responses must never acquire anonymous email/phone fields as the contract grows.
  function check(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/^(customer)?(email|phone)$/i.test(key), "Anonymous personal contact field");
      check(child);
    }
  }
  check(schedule);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, file, expected] = process.argv.slice(2);
    const data = JSON.parse(await readFile(file, "utf8"));
    if (mode === "instances") process.exitCode = currentImage(data, expected) ? 0 : 3;
    else if (mode === "schedule") process.exitCode = maskedSchedule(data) ? 0 : 3;
    else if (mode === "features") {
      assert.ok(expected === "true" || expected === "false");
      assert.equal(data.vehicleAwareRequirements, expected === "true");
    } else if (mode === "dates") {
      const dealership = data.find(item => item.name === "Keyloop Motors Reading");
      assert.ok(dealership && /^[a-f0-9-]{36}$/i.test(dealership.id));
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: dealership.timeZoneId }).format(new Date());
      for (let day = 0; day < 7; day++) {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + day);
        console.log(`/api/v1/dealerships/${dealership.id}/schedule?date=${date.toISOString().slice(0, 10)}`);
      }
    } else throw new Error("Unknown verification mode");
  } catch {
    console.error("Deployment response verification failed; response body withheld to protect personal data.");
    process.exitCode = 1;
  }
}

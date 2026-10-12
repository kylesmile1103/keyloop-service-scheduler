# Offline WMI manufacturer allowlist

Phase 1 uses six explicit manufacturer-submitted WMI mappings from the US NHTSA Vehicle Product Information Catalog (vPIC). Attribution: [vPIC API and data description](https://vpic.nhtsa.dot.gov/api/). `DecodeWMI` is the primary-source reference for review. No implementation or test calls those URLs. The allowlist is intentionally small: no unknown prefix is guessed, and adding a mapping requires reviewing the manufacturer record and adding an independent expected-value case.

| WMI | Normalized manufacturer | Primary-source lookup reference |
|---|---|---|
| WVW | VOLKSWAGEN | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/WVW?format=json |
| WBA | BMW | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/WBA?format=json |
| WDD | MERCEDES-BENZ | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/WDD?format=json |
| VF1 | RENAULT | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/VF1?format=json |
| JTD | TOYOTA | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/JTD?format=json |
| 5YJ | TESLA | https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/5YJ?format=json |

The reviewed mappings are compiled as an exhaustive switch in `Infrastructure/Vehicles/WmiDecoder.cs`; no runtime CSV parsing, reflection, identifier cache or database lookup is involved. WMI identifies the manufacturer only. A Tesla WMI does not authorize a BatteryElectric assertion: powertrain and class both remain Unknown. Manufacturer provenance is VinDecoded for a known WMI and Unknown otherwise. This is a deliberately limited manufacturer decode, not a VIN powertrain decoder or a registry service.

Task 31a verification is offline under the controller's no-external-service constraint. These references are attribution and review pointers, not a claim of a fresh upstream download during this task.

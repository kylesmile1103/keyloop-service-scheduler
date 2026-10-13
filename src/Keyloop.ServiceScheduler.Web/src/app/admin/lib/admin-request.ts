import type { Options } from "@/api/sdk.gen"
import type {
  ConfirmTechnicianHvLevelData,
  ConfirmTechnicianHvLevelErrors,
  ConfirmTechnicianHvLevelResponses,
  CreateBayData,
  CreateBayErrors,
  CreateBayResponses,
  CreateTechnicianData,
  CreateTechnicianErrors,
  CreateTechnicianResponses,
  EditBayData,
  EditBayErrors,
  EditBayResponses,
  EditRequirementPolicyData,
  EditRequirementPolicyErrors,
  EditRequirementPolicyResponses,
  EditTechnicianData,
  EditTechnicianErrors,
  EditTechnicianResponses,
  GetAdminBayData,
  GetAdminBayErrors,
  GetAdminBayResponses,
  GetAdminHistoryData,
  GetAdminHistoryErrors,
  GetAdminHistoryResponses,
  GetAdminTechnicianData,
  GetAdminTechnicianErrors,
  GetAdminTechnicianResponses,
  GetRequirementPolicyData,
  GetRequirementPolicyErrors,
  GetRequirementPolicyResponses,
  ListAdminBaysData,
  ListAdminBaysErrors,
  ListAdminBaysResponses,
  ListAdminTechniciansData,
  ListAdminTechniciansErrors,
  ListAdminTechniciansResponses,
} from "@/api/types.gen"
import { client } from "@/lib/api-client"

/**
 * The Admin operations of Task 30a, sent through the app's generated client exactly as the generated SDK functions send
 * them (`src/api/sdk.gen.ts`: the operation's URL pattern, the same security schemes, a JSON body's content type), but
 * from the admin area's own code. The generated SDK module is shared with the dispatch board, and a module goes into one
 * chunk with every export any page uses, so calling its Admin functions would put them in the board's first load
 * (ARCHITECTURE §15, measured at Task 30b). Every request is typed by the generated `...Data`, `...Responses` and
 * `...Errors`, and each URL must equal its operation's `url` type, so a contract change is a compile error here.
 */

const security = [
  { name: "Cf-Access-Jwt-Assertion", type: "apiKey" },
  { in: "cookie", name: "CF_Authorization", type: "apiKey" },
] as const

type Method = "get" | "post" | "put"

function send<TData extends { url: string; body?: unknown }, TResponses, TErrors>(method: Method, url: TData["url"], options: Options<TData, true>) {
  const json = (options as { body?: unknown }).body !== undefined
  return client[method]<TResponses, TErrors, true>({
    security,
    url,
    ...options,
    ...(json ? { headers: { "Content-Type": "application/json", ...options.headers } } : {}),
  })
}

export const listAdminTechnicians = (options: Options<ListAdminTechniciansData, true>) =>
  send<ListAdminTechniciansData, ListAdminTechniciansResponses, ListAdminTechniciansErrors>("get", "/api/v1/dealerships/{dealershipId}/technicians", options)

export const getAdminTechnician = (options: Options<GetAdminTechnicianData, true>) =>
  send<GetAdminTechnicianData, GetAdminTechnicianResponses, GetAdminTechnicianErrors>("get", "/api/v1/dealerships/{dealershipId}/technicians/{technicianId}", options)

export const createTechnician = (options: Options<CreateTechnicianData, true>) =>
  send<CreateTechnicianData, CreateTechnicianResponses, CreateTechnicianErrors>("post", "/api/v1/dealerships/{dealershipId}/technicians", options)

export const editTechnician = (options: Options<EditTechnicianData, true>) =>
  send<EditTechnicianData, EditTechnicianResponses, EditTechnicianErrors>("put", "/api/v1/dealerships/{dealershipId}/technicians/{technicianId}", options)

export const confirmTechnicianHvLevel = (options: Options<ConfirmTechnicianHvLevelData, true>) =>
  send<ConfirmTechnicianHvLevelData, ConfirmTechnicianHvLevelResponses, ConfirmTechnicianHvLevelErrors>(
    "post",
    "/api/v1/dealerships/{dealershipId}/technicians/{technicianId}/confirm-hv-level",
    options
  )

export const listAdminBays = (options: Options<ListAdminBaysData, true>) =>
  send<ListAdminBaysData, ListAdminBaysResponses, ListAdminBaysErrors>("get", "/api/v1/dealerships/{dealershipId}/bays", options)

export const getAdminBay = (options: Options<GetAdminBayData, true>) =>
  send<GetAdminBayData, GetAdminBayResponses, GetAdminBayErrors>("get", "/api/v1/dealerships/{dealershipId}/bays/{bayId}", options)

export const createBay = (options: Options<CreateBayData, true>) =>
  send<CreateBayData, CreateBayResponses, CreateBayErrors>("post", "/api/v1/dealerships/{dealershipId}/bays", options)

export const editBay = (options: Options<EditBayData, true>) =>
  send<EditBayData, EditBayResponses, EditBayErrors>("put", "/api/v1/dealerships/{dealershipId}/bays/{bayId}", options)

export const getRequirementPolicy = (options: Options<GetRequirementPolicyData, true>) =>
  send<GetRequirementPolicyData, GetRequirementPolicyResponses, GetRequirementPolicyErrors>("get", "/api/v1/dealerships/{dealershipId}/requirement-policy", options)

export const editRequirementPolicy = (options: Options<EditRequirementPolicyData, true>) =>
  send<EditRequirementPolicyData, EditRequirementPolicyResponses, EditRequirementPolicyErrors>("put", "/api/v1/dealerships/{dealershipId}/requirement-policy", options)

export const getAdminHistory = (options: Options<GetAdminHistoryData, true>) =>
  send<GetAdminHistoryData, GetAdminHistoryResponses, GetAdminHistoryErrors>("get", "/api/v1/dealerships/{dealershipId}/admin-history", options)

# System Design Document (Part 1)

This is the entry point for **Part 1: System Design** of the Keyloop technical assessment, Scenario A: The Unified Service Scheduler. The full document is [ARCHITECTURE.md](ARCHITECTURE.md) ("Architecture and System Design"); this page maps each item the brief asks for to the section that answers it, so nothing is duplicated.

| The brief asks for | Where it is answered |
|---|---|
| An architecture diagram | [§8.1 C4 system context](ARCHITECTURE.md#81-c4---system-context), [§8.2 C4 containers](ARCHITECTURE.md#82-c4---containers-with-aspire-orchestration), [§8.3 C4 components](ARCHITECTURE.md#83-c4---components-inside-the-scheduler-api) |
| A brief description of each component's role | [§8.2](ARCHITECTURE.md#82-c4---containers-with-aspire-orchestration) and [§8.3](ARCHITECTURE.md#83-c4---components-inside-the-scheduler-api) (each container and component with its responsibility), [§8.4 vertical-slice layout](ARCHITECTURE.md#84-vertical-slice-layout-and-conventions) |
| An explanation of the data flow | [§8.5 data flow, sequence diagrams](ARCHITECTURE.md#85-data-flow---sequence-diagrams), with the booking path's concurrency control in [§7](ARCHITECTURE.md#7-concurrency-and-data-integrity) |
| A list of chosen technologies with justifications | [§9 technology choices and justification](ARCHITECTURE.md#9-technology-choices-and-justification), and the decisions behind them in [§18 Architecture Decision Records](ARCHITECTURE.md#18-architecture-decision-records) |
| A strategy for observability (logging, metrics, tracing) | [§12 observability](ARCHITECTURE.md#12-observability) |
| A dedicated section on how GenAI assisted the design phase | [§16 GenAI co-design record](ARCHITECTURE.md#16-genai-co-design-record) |
| Assumptions made where the brief is ambiguous | [§3 assumptions and scope decisions](ARCHITECTURE.md#3-assumptions-and-scope-decisions) |

Start with the [executive summary](ARCHITECTURE.md#1-executive-summary). The other deliverables are listed in the [README](../README.md#submission-deliverables).

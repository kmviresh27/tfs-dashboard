# TFS Field Dictionary
## ISP Programme Dashboard — Decisions & Field Reference

> **Purpose:** Single source of truth for every TFS field name, state value, and configuration
> decision made while building the AV Dashboard. Update this file whenever a field is confirmed
> or corrected against the live TFS instance.

---

## 1. TFS Connection

| Setting | Value |
|---|---|
| Organisation | `TPC_Region11` |
| Project | `Healthcare IT` |
| Base URL | `https://tfs.yourorg.com/tfs/YourOrg/YourProject` |
| API Version | `5.0` |
| Area Path (root) | `Healthcare IT\ICAP\ISP` |
| Iteration Path (root) | `Healthcare IT\ISP` |

### Team root paths (used to extract team name from AreaPath)

| Team | Area path prefix |
|---|---|
| Hercules | `Healthcare IT\ICAP\ISP\Hercules` |
| Apollo | `Healthcare IT\ICAP\ISP\Apollo` |
| External Groups | `Healthcare IT\ICAP\ISP\External Groups` |

---

## 2. PI / Sprint Structure

Each calendar year is divided into 4 PIs, each PI maps to a quarter.  
Each PI contains **3 sprints** (S1, S2, S3) and **1 Innovation & Planning sprint** (IP).

### Iteration path format

```
Healthcare IT\ISP\{yy}-PI{n}\{yy}-PI{n} {sprint}
```

**Examples:**

| Iteration | Path |
|---|---|
| PI1 Sprint 1 (2026) | `Healthcare IT\ISP\26-PI1\26-PI1 S1` |
| PI1 Sprint 2 | `Healthcare IT\ISP\26-PI1\26-PI1 S2` |
| PI1 Sprint 3 | `Healthcare IT\ISP\26-PI1\26-PI1 S3` |
| PI1 IP sprint | `Healthcare IT\ISP\26-PI1\26-PI1 IP` |
| PI5 Sprint 3 (2025) | `Healthcare IT\ISP\25-PI5\25-PI5 S3` |

### PI ↔ Quarter mapping

| PI | Quarter | Months |
|---|---|---|
| PI1 | Q1 | Jan – Mar |
| PI2 | Q2 | Apr – Jun |
| PI3 | Q3 | Jul – Sep |
| PI4 | Q4 | Oct – Dec |

> **Dashboard rule:** when viewing Q2, the dashboard shows Q1 data.  
> A quarter-selector dropdown lets users manually choose any past quarter.

---

## 3. Work Item Types

| Type | Used for |
|---|---|
| `Feature` | Feature lifecycle tracking |
| `Bug` | Defect tracking |

---

## 4. Feature Fields

| Field name | TFS reference | Notes |
|---|---|---|
| ID | `System.Id` | Standard |
| Title | `System.Title` | Standard |
| State | `System.State` | See §5 |
| Area Path | `System.AreaPath` | Used to derive team |
| Iteration Path | `System.IterationPath` | Used for sprint/PI scoping |
| Assigned To | `System.AssignedTo` | Returns object — use `.displayName` |
| Created Date | `System.CreatedDate` | Standard |
| Changed Date | `System.ChangedDate` | ⚠️ updates on ANY field change, not just state transitions — **never use as sprint window proxy** |
| **Effort (size)** | `Microsoft.VSTS.Scheduling.Effort` | ✅ Confirmed. Story-point equivalent for Features in this instance |

### ❌ Feature fields that do NOT exist / must NOT be used

| Field | Reason |
|---|---|
| `Microsoft.VSTS.Scheduling.Size` | Does not exist — returns TF51535 error |
| `Microsoft.VSTS.Scheduling.StoryPoints` | Not set on Features; kept only as last-resort fallback |
| `Microsoft.VSTS.Common.Priority` | Not used for Features; use `Custom.Rank` for defects |

---

## 5. Feature States (lifecycle order)

```
Forecasted  →  New  →  Activated  →  Approved  →  Done
                                                  ↘  Removed
```

| State | Meaning | Dashboard treatment |
|---|---|---|
| `Forecasted` | Planned but not started | Not started; counts as "stale" with New |
| `New` | Acknowledged, work not begun | Not started; counts as "stale" |
| `Activated` | ✅ Added. Work has started | **WIP** state |
| `Approved` | In progress / committed | **WIP** state |
| `Done` | Completed | Delivered; counts toward velocity |
| `Removed` | Cancelled / descoped | Excluded from all ratios |

**WIP states:** `Activated`, `Approved` (and generic `In Progress`, `Active` for future-proofing)

---

## 6. Defect Fields

| Field name | TFS reference | Notes |
|---|---|---|
| ID | `System.Id` | Standard |
| Title | `System.Title` | Standard |
| State | `System.State` | See §7 |
| Area Path | `System.AreaPath` | Used to derive team |
| Iteration Path | `System.IterationPath` | Used for injection-rate grouping |
| Assigned To | `System.AssignedTo` | Standard |
| Created Date | `System.CreatedDate` | Used for aging calculation |
| Changed Date | `System.ChangedDate` | ⚠️ See warning under Feature Fields |
| Tags | `System.Tags` | Standard |
| **Rank / Priority** | `Custom.Rank` | ✅ Confirmed. Replaces `Microsoft.VSTS.Common.Priority` and `Microsoft.VSTS.Common.StackRank` |
| **How Found** | `Microsoft.VSTS.CMMI.HowFound` | ✅ Confirmed |
| **Where Found** | `Custom.Defects.WhereFound` | ✅ Confirmed. org-specific custom field |
| Severity | `Microsoft.VSTS.Common.Severity` | ⚠️ Exists but **often not populated** — not reliable for filtering |
| **Found In (build)** | `Microsoft.VSTS.Build.FoundIn` | ✅ Confirmed. Used for "Found In Pipeline Stage" chart |
| Effort (size) | `Microsoft.VSTS.Scheduling.Effort` | Same as Feature size field |

### ❌ Defect fields that must NOT be used

| Field | Replaced by |
|---|---|
| `Microsoft.VSTS.Common.Priority` | `Custom.Rank` |
| `Microsoft.VSTS.Common.StackRank` | `Custom.Rank` |

---

## 7. Defect States (lifecycle order)

```
New  →  Accepted  →  Investigated  →  Planned  →  Resolved  →  Closed
                                                              ↘  Removed
```

| State | Meaning | Escape ratio bucket |
|---|---|---|
| `New` | Just raised, not triaged | **Escaped** |
| `Accepted` | Triaged, accepted as valid | **Escaped** |
| `Investigated` | ✅ Added. Under investigation | **Escaped** |
| `Planned` | Fix planned, sprint assigned | (neutral — not escaped, not caught) |
| `Resolved` | Fix implemented | **Caught** |
| `Closed` | ✅ Added. Verified and closed | **Caught** |
| `Removed` | Invalid / duplicate / not a defect | Excluded from all calculations |

---

## 8. Defect Escape Ratio Formula

```
Escaped  =  New + Accepted + Investigated
Caught   =  Resolved + Closed

Escape Ratio (%) = Escaped ÷ (Escaped + Caught) × 100
```

> `Planned` is intentionally excluded from both buckets — it is a "work-in-progress" state
> between acknowledged and fixed, and including it would distort the ratio.

### RAG thresholds (configurable in `config.json`)

| Colour | Threshold |
|---|---|
| 🟢 Green | ≤ 20% |
| 🟡 Amber | 20–40% |
| 🔴 Red | > 40% |

---

## 9. SLA Breach Thresholds

Based on `Custom.Rank` value on the defect work item.

| Rank | Max open days before breach |
|---|---|
| 1 (highest) | 7 days |
| 2 | 14 days |
| 3+ / unset | 30 days |

---

## 10. Resolve Rate Formula

```
Resolved  =  count of defects in state Resolved or Closed
Active    =  total defects − Removed

Resolve Rate (%) = Resolved ÷ Active × 100
```

---

## 11. config.json Reference

All tunable values live in `config.json` at the project root.

```jsonc
{
  "tfs": {
    "organization": "TPC_Region11",
    "project": "Healthcare IT",
    "baseUrl": "...",
    "pat": "<personal access token>",
    "apiVersion": "5.0",
    "areaPath": "Healthcare IT\\ICAP\\ISP",
    "teamRootPath": ["Healthcare IT\\ICAP\\ISP\\Hercules", ...],
    "iterationPath": "Healthcare IT\\ISP"
  },
  "sizeField": "Microsoft.VSTS.Scheduling.Effort",   // feature/defect effort
  "defectFields": {
    "howFoundField":   "Microsoft.VSTS.CMMI.HowFound",
    "whereFoundField": "Custom.Defects.WhereFound",
    "severityField":   "Microsoft.VSTS.Common.Severity",  // often empty
    "rankField":       "Custom.Rank"
  },
  "defectEscapeRatio": {
    "escapedStates": ["New", "Accepted", "Investigated"],
    "caughtStates":  ["Resolved", "Closed"]
  },
  "ragThresholds": {
    "doneRate":      { "green": 80, "amber": 50 },
    "resolveRate":   { "green": 70, "amber": 40 },
    "escapeRatio":   { "green": 20, "amber": 40 },
    "healthScore":   { "green": 70, "amber": 40 },
    "defectDensity": { "green": 1.5, "amber": 3 }
  }
}
```

---

## 12. Key Implementation Decisions

| Decision | Rationale |
|---|---|
| Use `IterationPath UNDER` for sprint scoping | `ChangedDate` updates on any field change — using it as a sprint window incorrectly included re-opened/re-assigned items |
| `Custom.Rank` for priority | `Microsoft.VSTS.Common.Priority` is not populated; `Custom.Rank` is the actual ranking field in this TFS instance |
| `Effort` not `StoryPoints` | Features carry effort in `Microsoft.VSTS.Scheduling.Effort`; `StoryPoints` is kept only as a last-resort fallback |
| `Activated` added as WIP | Feature lifecycle has a discrete `Activated` state between `New` and `Approved`; both count as WIP |
| `Investigated` added to Escaped | Defects under investigation are not yet caught/fixed — they should count as escaped |
| `Closed` added to Caught | `Closed` is the terminal "verified done" state; it must count as caught alongside `Resolved` |
| `Planned` excluded from escape ratio | `Planned` is a transitional state (fix scheduled but not done); including it would undercount escaped defects |
| `Severity` not used for filtering | `Microsoft.VSTS.Common.Severity` exists in the schema but is rarely populated — displayed only, never used as a filter condition |
| `Removed` excluded universally | Removed features and defects are descoped items; they are excluded from totals, ratios, and charts |


# AV TFS Dashboard

**Multi-tenant Azure DevOps / TFS Live Programme Dashboard**

A real-time PI planning and quality dashboard for engineering teams using Azure DevOps (cloud or on-prem TFS). Monitors feature lifecycle, defect quality, team velocity, predictability, and programme health — across multiple departments in a single hosted instance.

---

## What It Does

| Section | Description |
|---|---|
| 📋 **Executive Summary** | Programme health score, RAG KPIs, team scorecards |
| 🚀 **Features** | Lifecycle funnel, velocity, WIP, cycle time, predictability |
| 🐛 **Defects** | Escape ratio, aging, injection rate, SLA breach, team breakdown |
| ⚡ **Velocity** | Sprint-by-sprint story points: committed vs delivered |
| 📈 **Sprint Trend** | Per-sprint done rate and health across PIs |
| 📊 **Cross-PI Trends** | PI-over-PI metric comparisons |
| 🎯 **PI Delivery** | PI delivery summary and insights |
| 🗺 **Roadmap** | Feature roadmap by team and sprint |
| ⚙ **Settings** | Per-department TFS config, field mappings, branding, policies |

**Cross-cutting capabilities:**
- 🔗 Clickable TFS links on every chart — opens live work item query in Azure DevOps
- 🔄 30-minute auto-refresh with countdown and manual override
- 🏢 Multi-tenant: one deployment, multiple isolated departments
- 👔 Role-based access: Super Admin / Dept Admin / Member
- 📸 PI Planning Snapshots for predictability measurement
- 🖨 Print / PDF export and Microsoft Teams digest notifications
- 🔍 Global search across all work item data

---

## Quick Start

### Prerequisites
- **Node.js 18+** — https://nodejs.org
- A **Personal Access Token (PAT)** from Azure DevOps with *Work Items (Read)* scope

### Setup

```powershell
# 1. Run the interactive setup wizard (recommended for first-time setup)
.\scripts\setup.ps1
```

Or configure manually:

```bash
# 1. Install dependencies
npm install

# 2. Create config from template
copy config.sample.json config.json
# Edit config.json — set baseUrl, pat, areaPath, iterationPath

# 3. Build the React frontend
npm run build

# 4. Start the server
node server.js
# Open http://localhost:3000
```

---

## Configuration

All settings live in `config.json` (git-ignored — never commit your PAT).

### TFS / Azure DevOps Connection

```json
{
  "tfs": {
    "baseUrl": "https://dev.azure.com/MyOrg/MyProject",
    "pat": "YOUR_PAT",
    "apiVersion": "6.0",
    "areaPath": "MyProject\\MyTeam",
    "iterationPath": "MyProject"
  }
}
```

| Connection type | `baseUrl` format | `apiVersion` |
|---|---|---|
| Azure DevOps cloud | `https://dev.azure.com/Org/Project` | `6.0` |
| Azure DevOps Server / TFS on-prem | `https://your-server/tfs/Collection/Project` | `5.0` |

### PI & Sprint Naming

Configure patterns to match your ADO iteration structure:

```json
{
  "piNamingPattern": "{yy}-PI{n}",
  "sprintSubpathPattern": "{pi} {sprint}",
  "sprintLabels": ["S1", "S2", "S3", "IP"]
}
```

| Pattern variable | Example result | Use for |
|---|---|---|
| `{yy}-PI{n}` | `26-PI1` | Standard yearly PI naming |
| `PI{yy}.{n}` | `PI26.1` | Dot-separated quarterly naming |
| `{pi} {sprint}` | `26-PI1 S1` | Space-separated sprint path |
| `{pi}-{sprint}` | `PI26.1-SP1` | Dash-separated sprint path |

---

## Multi-Tenant Setup

AV Dashboard supports multiple isolated departments in one instance.

1. Log in as Super Admin
2. Go to ⚡ Actions → Admin
3. Click **＋ New Department** — provide a department ID, name, and TFS connection
4. Add users to departments via Admin → Department → Members
5. Each department gets its own TFS connection, PI config, field mappings, and policies

---

## Deployment

### Windows Service (via NSSM)

```powershell
# Install as auto-start Windows service
.\scripts\deploy.ps1 -DeployDir "C:\apps\av-dashboard" -Port 3000

# Uninstall service
.\scripts\undeploy.ps1
```

> NSSM is optional. If not present, `deploy.ps1` creates a `start.ps1` launcher instead.  
> Download NSSM from https://nssm.cc

### Create Release Package (ZIP)

```powershell
.\scripts\package.ps1 -Version "2.0.0" -OutputDir "D:\releases"
```

Produces `av-dashboard-2.0.0.zip` — a self-contained archive with built frontend and production dependencies.

### Firewall (for network access)

```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "AV Dashboard" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

---

## Project Structure

```
AV Dashboard/
├── server.js                     # Express entry point
├── config.json                   # Runtime config (git-ignored — contains PAT)
├── config.sample.json            # Config template (safe to share)
├── package.json
├── run.bat                       # Convenience launcher
├── src/
│   ├── config.js                 # Config loader
│   ├── tfsClient.js              # Azure DevOps / TFS HTTP client
│   ├── middleware/auth.js        # Session auth, requireAuth, requireDeptAdmin
│   ├── helpers/
│   │   ├── piHelpers.js          # PI naming, sprint path building, date logic
│   │   ├── fieldMappings.js      # Per-dept field mapping merge logic
│   │   ├── dataProcessors.js     # Feature / defect processing helpers
│   │   └── snapshots.js          # Snapshot read/write helpers
│   └── routes/                   # One Express Router per domain
│       ├── auth.js               # /api/auth/*
│       ├── departments.js        # /api/admin/*, /api/d/:deptId/members, /policies
│       ├── dashboard.js          # /api/features, /api/defects, /api/teams
│       ├── velocity.js           # /api/velocity
│       ├── sprint.js             # /api/sprint-trend
│       ├── predictability.js     # /api/predictability
│       ├── insights.js           # /api/insights/*
│       ├── reports.js            # /api/reports/*
│       └── ...                   # (see src/routes/ for full list)
├── client/                       # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx               # Router + layout
│   │   ├── sections/             # One component per dashboard section
│   │   ├── components/           # Shared UI components
│   │   └── data/helpContent.js   # In-app help documentation
│   └── dist/                     # Built output (served by Express)
├── data/
│   ├── users.json                # User accounts (git-ignored)
│   └── departments/              # Per-department configs and snapshots
│       └── {dept-id}/
│           ├── config.json       # Department TFS connection + settings
│           └── snapshots/        # PI planning snapshots
├── docs/                         # In-app documentation (served at /docs/)
│   ├── index.html                # Documentation hub
│   ├── user-manual.html          # End-user guide
│   ├── settings-guide.html       # Detailed settings reference
│   └── ado-upgrade-guide.html    # ADO / TFS setup guide
└── scripts/
    ├── setup.ps1                 # First-run setup wizard
    ├── deploy.ps1                # Deploy to directory + Windows service
    ├── package.ps1               # Create production ZIP
    └── undeploy.ps1              # Remove Windows service
```

---

## Security Notes

- `config.json` is git-ignored — never commit it (contains your PAT)
- PATs are stored in department config files under `data/departments/` (also git-ignored)
- Session cookies use `httpOnly` and `sameSite=strict`
- Super-admin routes are protected server-side (URL navigation doesn't bypass auth)
- All TFS queries run server-side — the PAT is never exposed to the browser

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `TF51011: iteration path does not exist` | Check `piNamingPattern` / `sprintSubpathPattern` matches your ADO iteration tree exactly |
| `401 Unauthorized` | PAT expired or missing Work Items (Read) scope — regenerate it |
| Empty charts | Verify `areaPath` and `iterationPath` in config — test with Settings → Connection |
| Can't log in | Check `data/users.json` exists; run `.\scripts\setup.ps1` to create an admin account |
| Slow loading (>15s) | Narrow `areaPath` to only the teams you need; increase `refreshIntervalMinutes` |

For more help, open the in-app help panel (? button in the top bar) or visit `/docs/`.

---

## Documentation

Full documentation is available at `http://localhost:3000/docs/` when the server is running:

- [User Manual](/docs/user-manual.html) — guide for all dashboard sections
- [Settings Guide](/docs/settings-guide.html) — all configuration options
- [ADO/TFS Setup Guide](/docs/ado-upgrade-guide.html) — server-specific configuration

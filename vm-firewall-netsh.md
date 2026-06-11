# VM Firewall — netsh Instructions

## Allow Port 3000 (Node.js Dashboard)

### Check if rule already exists
```powershell
netsh advfirewall firewall show rule name="Node 3000"
```

### Add inbound rule (allow external access to port 3000)
```powershell
netsh advfirewall firewall add rule name="Node 3000" dir=in action=allow protocol=TCP localport=3000
```

### Delete rule
```powershell
netsh advfirewall firewall delete rule name="Node 3000"
```

### Check all inbound rules for port 3000
```powershell
netsh advfirewall firewall show rule dir=in | findstr "3000"
```

---

## Verify Port is Open and Listening

```powershell
# Check node is listening on port 3000
netstat -ano | findstr ":3000"

# Check which process owns the PID
Get-Process -Id <PID>

# Test local connectivity
(Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing).StatusCode
```

---

## Full Firewall Profile Coverage
By default the `add rule` above applies to all profiles (Domain, Private, Public).
To restrict to Domain only:
```powershell
netsh advfirewall firewall add rule name="Node 3000" dir=in action=allow protocol=TCP localport=3000 profile=domain
```

---

## Check Windows Firewall Status
```powershell
# All profiles on/off
netsh advfirewall show allprofiles state

# Domain profile only
netsh advfirewall show domainprofile
```

---

## PowerShell Alternative (if netsh is blocked)
```powershell
# Add rule
New-NetFirewallRule -DisplayName "Node 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow

# Remove rule
Remove-NetFirewallRule -DisplayName "Node 3000"

# Check rule
Get-NetFirewallRule -DisplayName "Node 3000"
```

---

## Diagnose ERR_SSL_PROTOCOL_ERROR

Run these on the VM to identify the root cause:

### Step 1 — Confirm patch is in the file
```powershell
Select-String "upgradeInsecureRequests" "D:\AV Dashboard\server.js"
```
→ Must return **nothing**. If it shows a match, run `fix-helmet.ps1` again.

### Step 2 — Check what the server is actually sending
```powershell
(Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing).Headers['Content-Security-Policy']
```
→ Must **not** contain `upgrade-insecure-requests`

### Step 3 — If CSP is still wrong, restart node with the fixed code
```powershell
# Find current PID
netstat -ano | findstr ":3000"

# Kill it
Stop-Process -Id <PID> -Force
Start-Sleep 2

# Restart
Start-Process node -ArgumentList "server.js" -WorkingDirectory "D:\AV Dashboard" -WindowStyle Hidden
Start-Sleep 3

# Verify
netstat -ano | findstr ":3000"
(Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing).Headers['Content-Security-Policy']
```

### Step 4 — Browser HSTS cache (if server CSP is clean)
If Step 2 confirms CSP is clean but browser still shows SSL errors:

| Fix | Steps |
|-----|-------|
| **Incognito** | `Ctrl+Shift+N` → open `http://144.54.104.49:3000` |
| **Clear HSTS** | Chrome → `chrome://net-internals/#hsts` → Delete domain `144.54.104.49` |
| **Firefox/Edge** | Open directly — no HSTS cached |

### Step 5 — Nuclear option: disable Helmet entirely (no-op)
If all else fails, replace `helmet` with a no-op so it sends **zero security headers**:
```powershell
cd "D:\AV Dashboard"

# Patch server.js — helmet becomes a no-op
node -e "const fs=require('fs');let c=fs.readFileSync('server.js','utf8');c=c.replace(/const helmet\s*=\s*require\('helmet'\);/,'const helmet = () => (req,res,next) => next();');fs.writeFileSync('server.js',c);console.log('Patched OK');"

# Kill old node process (replace PID)
Stop-Process -Id <PID> -Force
Start-Sleep 2

# Restart
Start-Process node -ArgumentList "server.js" -WorkingDirectory "D:\AV Dashboard" -WindowStyle Hidden
Start-Sleep 3

# Verify — CSP header should now be empty/absent
(Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing).Headers['Content-Security-Policy']
```
> This replaces `require('helmet')` with a dummy function that does nothing.
> `app.use(helmet({...}))` stays in the file but becomes harmless.
> No HSTS, no CSP, no upgrade-insecure-requests — HTTP server works cleanly.

---

## Helmet / HTTPS Fix (server.js)

If browser shows `ERR_SSL_PROTOCOL_ERROR` on HTTP server, run the fix script:
```powershell
cd "D:\AV Dashboard\scripts"
.\fix-helmet.ps1
```

Then clear Chrome HSTS cache:
- Open `chrome://net-internals/#hsts`
- Delete domain: `144.54.104.49`
- Reload `http://144.54.104.49:3000`

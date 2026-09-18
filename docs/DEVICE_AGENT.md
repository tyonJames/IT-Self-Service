# Device tracking agent

The device agent is a PowerShell script that runs on Radx laptops and desktops and
reports back to the help desk. This document is the wire protocol and a sample script
that IT can drop onto machines with a scheduled task.

## Wire protocol

### Enrolment

```
POST https://helpdesk.radx.co.zw/device/enrol/
Content-Type: application/json

{
  "serial_number": "7XQ4RN3",
  "hostname":      "LAPTOP-01",
  "agent_version": "1.0.0"
}
```

Response:

```json
{
  "asset_id":    142,
  "asset_tag":   "RDX-ZL014",
  "device_key":  "8f1e…64-hex-chars",
  "report_url":  "/device/report/",
  "message":     "Enrolled. Store this key securely — it cannot be retrieved again."
}
```

**Save `device_key` on the device immediately.** The server keeps only a SHA-256 digest
of it (see [docs/CHANGE_CONTROL.md CC-004](CHANGE_CONTROL.md)); it cannot be recovered
from the server. Losing it means asking IT to rotate.

### Check-in

```
POST https://helpdesk.radx.co.zw/device/report/
Authorization: Bearer 8f1e…64-hex-chars
Content-Type: application/json

{
  "hostname":       "LAPTOP-01",
  "logged_in_user": "RADX\\tmoyo",
  "wifi_ssid":      "Radx-HQ",
  "latitude":       null,
  "longitude":      null,
  "gps_accuracy_m": null,
  "agent_version":  "1.0.0",
  "notes":          ""
}
```

The device key can also travel in the body as `device_key`. The public IP is taken from
the connection, not from the body — the device does not need to know it.

Successful check-in returns `{ "status": "recorded", "asset_id": 142 }`.

Errors:

- `401 device_auth_failed` — key unknown or rotated. Rotate through the asset detail
  page and re-enrol.
- `429 rate_limited` — the app tolerates a check-in roughly every 15 seconds. A stuck
  agent that spins tighter will be throttled.

## Key rotation

An agent going quiet or a device disappearing is a security event. In the asset detail
page, an agent user clicks **Rotate device key**; the new key is displayed once and the
previous one stops working on the very next request. Push the new key to the agent
through the endpoint-management tool of your choice.

## Sample PowerShell agent

Save as `%ProgramData%\Radx\Agent\agent.ps1` and drive from a scheduled task running as
`SYSTEM` every 15 minutes.

```powershell
Param(
    [string]$BaseUrl   = "https://helpdesk.radx.co.zw",
    [string]$KeyFile   = "$env:ProgramData\Radx\Agent\device-key",
    [string]$AgentVer  = "1.0.0"
)

$ErrorActionPreference = "Stop"

function Get-DeviceKey {
    if (Test-Path $KeyFile) { return (Get-Content -Path $KeyFile -Raw).Trim() }

    $serial = (Get-CimInstance Win32_BIOS).SerialNumber
    $body   = @{ serial_number = $serial; hostname = $env:COMPUTERNAME; agent_version = $AgentVer } | ConvertTo-Json
    $enrol  = Invoke-RestMethod -Method Post -Uri "$BaseUrl/device/enrol/" -Body $body -ContentType 'application/json'

    # The key is returned once. Store it with restrictive ACLs so only SYSTEM can read.
    $keyDir = Split-Path $KeyFile -Parent
    if (-not (Test-Path $keyDir)) { New-Item -ItemType Directory -Path $keyDir | Out-Null }
    Set-Content -Path $KeyFile -Value $enrol.device_key -NoNewline
    icacls $KeyFile /inheritance:r /grant:r "SYSTEM:F" /grant:r "Administrators:R" | Out-Null

    return $enrol.device_key
}

function Get-WifiSsid {
    try {
        $line = netsh wlan show interfaces | Select-String -Pattern '^\s+SSID\s+:\s+(.+)$' | Select-Object -First 1
        if ($line) { return $line.Matches[0].Groups[1].Value.Trim() }
    } catch {}
    return ""
}

$key   = Get-DeviceKey
$user  = try { (Get-CimInstance Win32_ComputerSystem).UserName } catch { $env:USERNAME }
$body  = @{
    hostname       = $env:COMPUTERNAME
    logged_in_user = $user
    wifi_ssid      = Get-WifiSsid
    agent_version  = $AgentVer
} | ConvertTo-Json

try {
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/device/report/" `
        -Headers @{ Authorization = "Bearer $key" } `
        -Body $body -ContentType 'application/json' | Out-Null
} catch [System.Net.WebException] {
    # 401 means the key was rotated — drop the local file so the next run re-enrols.
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { Remove-Item $KeyFile -Force }
    throw
}
```

Rotate the file's ACLs so only `SYSTEM` and `Administrators` can read it. Do not print
the key to the Windows event log; the sample above deliberately does not.

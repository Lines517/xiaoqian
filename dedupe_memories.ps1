# ============================================================
#  林间一盏灯 · 规整 + 去重 cozy_memories（庇护所记忆）
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$patchHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal"; "Content-Type" = "application/json" }

function Normalize-Date($d) {
    $s = [string]$d
    if ($s -match '^(\d{4})[/-](\d{1,2})[/-](\d{1,2})') {
        return "{0}-{1:D2}-{2:D2}" -f $matches[1], [int]$matches[2], [int]$matches[3]
    }
    return $s
}

Write-Host "① 拉取 cozy_memories ..." -ForegroundColor Cyan
$rows = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?select=id,memory_date,memory,emotion,state,folder&order=id.asc" -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
$all = @($rows)
Write-Host ("   共 {0} 条" -f $all.Count) -ForegroundColor Green

Write-Host "② 备份 ..." -ForegroundColor Cyan
$bakDir = "D:\林间一盏灯_聊天备份\清理前备份"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }
$bak = Join-Path $bakDir ("cozy_memories_清理前_{0}.json" -f (Get-Date -Format "yyyyMMdd_HHmm"))
$all | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $bak -Encoding UTF8
Write-Host ("   已备份: {0}" -f $bak) -ForegroundColor Green

Write-Host "③ 规整日期格式 ..." -ForegroundColor Cyan
$fixed = 0
foreach ($r in $all) {
    $norm = Normalize-Date $r.memory_date
    if ($norm -ne [string]$r.memory_date) {
        try {
            $body = @{ memory_date = $norm } | ConvertTo-Json
            Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=eq.$($r.id)" -Method Patch -Headers $patchHeaders -Body $body -UseBasicParsing -TimeoutSec 30 | Out-Null
            $r.memory_date = $norm
            $fixed++
        } catch {}
    }
}
Write-Host ("   已规整 {0} 条" -f $fixed) -ForegroundColor Green

Write-Host "④ 计算重复 ..." -ForegroundColor Cyan
$md5 = [System.Security.Cryptography.MD5]::Create()
function Get-Key($date, $memory) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$date|$memory")
    return [System.BitConverter]::ToString($md5.ComputeHash($bytes))
}
$first = @{}
$dups = New-Object System.Collections.Generic.List[int]
foreach ($r in $all) {
    $k = Get-Key (Normalize-Date $r.memory_date) ([string]$r.memory)
    if ($first.ContainsKey($k)) { $dups.Add([int]$r.id) } else { $first[$k] = [int]$r.id }
}
Write-Host ("   唯一: {0}  重复: {1}" -f $first.Count, $dups.Count) -ForegroundColor Yellow

Write-Host "⑤ 删除重复 ..." -ForegroundColor Cyan
$deleted = 0
for ($i = 0; $i -lt $dups.Count; $i += 80) {
    $end = [Math]::Min($i + 79, $dups.Count - 1)
    $idList = ($dups[$i..$end] -join ',')
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=in.($idList)" -Method Delete -Headers $patchHeaders -UseBasicParsing -TimeoutSec 60 | Out-Null
        $deleted += ($end - $i + 1)
    } catch { Write-Host ("   失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}
Write-Host ("   已删除 {0} 条" -f $deleted) -ForegroundColor Green
Write-Host "完成。" -ForegroundColor Green

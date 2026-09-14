# ============================================================
#  林间一盏灯 · 每天只保留最新一份庇护所记忆
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$delHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal" }

function Normalize-Date($d) {
    $s = [string]$d
    if ($s -match '^(\d{4})[/-](\d{1,2})[/-](\d{1,2})') { return "{0}-{1:D2}-{2:D2}" -f $matches[1], [int]$matches[2], [int]$matches[3] }
    return $s
}

$rows = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?select=id,memory_date&order=id.asc" -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
$all = @($rows)
Write-Host ("共 {0} 条" -f $all.Count) -ForegroundColor Cyan

# 备份
$bakDir = "D:\林间一盏灯_聊天备份\清理前备份"
$bak = Join-Path $bakDir ("cozy_memories_保留最新前_{0}.json" -f (Get-Date -Format "yyyyMMdd_HHmm"))
$all | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $bak -Encoding UTF8
Write-Host ("已备份: {0}" -f $bak) -ForegroundColor Green

# 每组（按日期）保留最大 id
$maxId = @{}
foreach ($r in $all) {
    $d = Normalize-Date $r.memory_date
    if (-not $maxId.ContainsKey($d) -or [int]$r.id -gt $maxId[$d]) { $maxId[$d] = [int]$r.id }
}
$del = New-Object System.Collections.Generic.List[int]
foreach ($r in $all) {
    $d = Normalize-Date $r.memory_date
    if ([int]$r.id -ne $maxId[$d]) { $del.Add([int]$r.id) }
}
Write-Host ("将删除 {0} 条，保留 {1} 条" -f $del.Count, $maxId.Count) -ForegroundColor Yellow

$deleted = 0
for ($i = 0; $i -lt $del.Count; $i += 80) {
    $end = [Math]::Min($i + 79, $del.Count - 1)
    $idList = ($del[$i..$end] -join ',')
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=in.($idList)" -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 60 | Out-Null
        $deleted += ($end - $i + 1)
    } catch { Write-Host ("失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}
Write-Host ("已删除 {0} 条" -f $deleted) -ForegroundColor Green
Write-Host "完成。" -ForegroundColor Green

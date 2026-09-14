# ============================================================
#  林间一盏灯 · 清理 cozy_chats 重复记录
#  步骤：全量备份 -> 按(session_id+role+content)分组 -> 保留最小id -> 删除其余
# ============================================================
$ErrorActionPreference = 'Stop'

$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"

$baseDir = "D:\林间一盏灯_聊天备份"
$bakDir  = Join-Path $baseDir "清理前备份"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }

$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$delHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal" }

Write-Host "① 正在拉取全部记录..." -ForegroundColor Cyan
$list = New-Object System.Collections.Generic.List[object]
$offset = 0
$pageSize = 1000
while ($true) {
    $uri = "$SUPABASE_URL/rest/v1/cozy_chats?select=id,session_id,role,content&order=id.asc&limit=$pageSize&offset=$offset"
    $batch = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 120).Content | ConvertFrom-Json
    if ($null -eq $batch) { break }
    $arr = @($batch)
    if ($arr.Count -eq 0) { break }
    foreach ($item in $arr) { [void]$list.Add($item) }
    Write-Host ("   已拉取 {0} 条..." -f $list.Count)
    if ($arr.Count -lt $pageSize) { break }
    $offset += $pageSize
}
$all = $list
Write-Host ("   共拉取 {0} 条" -f $all.Count) -ForegroundColor Green

Write-Host "② 备份中..." -ForegroundColor Cyan
$stamp = Get-Date -Format "yyyyMMdd_HHmm"
$bakFile = Join-Path $bakDir ("cozy_chats_清理前_{0}.json" -f $stamp)
$all | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $bakFile -Encoding UTF8
Write-Host ("   已备份到: {0}" -f $bakFile) -ForegroundColor Green

Write-Host "③ 计算重复..." -ForegroundColor Cyan
$md5 = [System.Security.Cryptography.MD5]::Create()
function Get-Key($sessionId, $role, $content) {
    $s = "$sessionId|$role|$content"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
    $hash = $md5.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hash)
}

$firstIdByKey = @{}
$dupIds = New-Object System.Collections.Generic.List[int]
foreach ($row in $all) {
    $key = Get-Key $row.session_id $row.role ([string]$row.content)
    if ($firstIdByKey.ContainsKey($key)) {
        $dupIds.Add([int]$row.id)
    } else {
        $firstIdByKey[$key] = [int]$row.id
    }
}
Write-Host ("   唯一记录: {0}" -f $firstIdByKey.Count) -ForegroundColor Green
Write-Host ("   重复记录: {0}" -f $dupIds.Count) -ForegroundColor Yellow

if ($dupIds.Count -eq 0) {
    Write-Host "没有重复记录，无需删除。" -ForegroundColor Green
    exit 0
}

Write-Host "④ 删除重复中（分批）..." -ForegroundColor Cyan
$deleted = 0
$batchSize = 80
for ($i = 0; $i -lt $dupIds.Count; $i += $batchSize) {
    $end = [Math]::Min($i + $batchSize - 1, $dupIds.Count - 1)
    $slice = $dupIds[$i..$end]
    $idList = ($slice -join ',')
    $uri = "$SUPABASE_URL/rest/v1/cozy_chats?id=in.($idList)"
    try {
        Invoke-WebRequest -Uri $uri -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 60 | Out-Null
        $deleted += $slice.Count
    } catch {
        Write-Host ("   删除批次失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}
Write-Host ("   已删除 {0} 条重复记录" -f $deleted) -ForegroundColor Green
Write-Host "完成。" -ForegroundColor Green

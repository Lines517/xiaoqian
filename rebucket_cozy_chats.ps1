# ============================================================
#  林间一盏灯 · 按北京时间(凌晨5点为界)重新归档聊天记录
#  只读取 id/created_at/session_id，不读大字段，速度快
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$patchHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal"; "Content-Type" = "application/json" }

function Get-CorrectSessionId($iso) {
    $dto = [System.DateTimeOffset]::Parse($iso).ToOffset([TimeSpan]::FromHours(8))
    $bj = $dto.DateTime
    if ($bj.Hour -lt 5) { $bj = $bj.AddDays(-1) }
    return $bj.ToString("yyyy-MM-dd")
}

Write-Host "① 拉取所有 id/created_at/session_id ..." -ForegroundColor Cyan
$list = New-Object System.Collections.Generic.List[object]
$offset = 0; $pageSize = 1000
while ($true) {
    $uri = "$SUPABASE_URL/rest/v1/cozy_chats?select=id,created_at,session_id&order=id.asc&limit=$pageSize&offset=$offset"
    $batch = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    $arr = @($batch)
    if ($arr.Count -eq 0) { break }
    foreach ($it in $arr) { [void]$list.Add($it) }
    if ($arr.Count -lt $pageSize) { break }
    $offset += $pageSize
}
Write-Host ("   共 {0} 条" -f $list.Count) -ForegroundColor Green

Write-Host "② 计算需要修改的记录 ..." -ForegroundColor Cyan
$byTarget = @{}   # 目标日期 -> id 列表
$changed = 0
foreach ($row in $list) {
    $correct = Get-CorrectSessionId $row.created_at
    $old = [string]$row.session_id
    if ($old -ne $correct) {
        if (-not $byTarget.ContainsKey($correct)) { $byTarget[$correct] = New-Object System.Collections.Generic.List[int] }
        $byTarget[$correct].Add([int]$row.id)
        $changed++
    }
}
Write-Host ("   需要重新归档 {0} 条" -f $changed) -ForegroundColor Yellow
foreach ($k in $byTarget.Keys) { Write-Host ("      -> {0}: {1} 条" -f $k, $byTarget[$k].Count) }

if ($changed -eq 0) { Write-Host "无需修改。" -ForegroundColor Green; exit 0 }

Write-Host "③ 分批更新 session_id ..." -ForegroundColor Cyan
$updated = 0
foreach ($target in $byTarget.Keys) {
    $ids = $byTarget[$target]
    for ($i = 0; $i -lt $ids.Count; $i += 80) {
        $end = [Math]::Min($i + 79, $ids.Count - 1)
        $slice = $ids[$i..$end]
        $idList = ($slice -join ',')
        $uri = "$SUPABASE_URL/rest/v1/cozy_chats?id=in.($idList)"
        $body = @{ session_id = $target } | ConvertTo-Json
        try {
            Invoke-WebRequest -Uri $uri -Method Patch -Headers $patchHeaders -Body $body -UseBasicParsing -TimeoutSec 60 | Out-Null
            $updated += $slice.Count
        } catch { Write-Host ("   更新失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
    }
}
Write-Host ("   已更新 {0} 条" -f $updated) -ForegroundColor Green
Write-Host "完成。" -ForegroundColor Green

# ============================================================
#  林间一盏灯 · 恢复并"相似度去重"庇护所记忆
#  规则：仅合并高度相似(>=0.72)的；不同话题的全部保留
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$postHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "application/json"; Prefer = "return=minimal" }
$delHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal" }

$bak = "D:\林间一盏灯_聊天备份\清理前备份\cozy_memories_清理前_20260914_0855.json"
Write-Host "读取备份: $bak" -ForegroundColor Cyan
$parsed = (Get-Content -LiteralPath $bak -Raw -Encoding UTF8) | ConvertFrom-Json
$mems = @($parsed)
Write-Host ("   共 {0} 条" -f $mems.Count) -ForegroundColor Green

function Normalize($s) {
    $t = [string]$s
    $t = $t -replace '\s', ''
    $t = $t -replace '[，。、；：""''（）,.;:()\[\]【】]', ''
    return $t
}
function Bigrams($s) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    if ($s.Length -lt 2) { [void]$set.Add($s); return $set }
    for ($i = 0; $i -lt $s.Length - 1; $i++) { [void]$set.Add($s.Substring($i, 2)) }
    return $set
}
function Similar($a, $b) {
    if ($a -eq $b) { return $true }
    $A = Bigrams $a; $B = Bigrams $b
    $inter = 0
    foreach ($x in $A) { if ($B.Contains($x)) { $inter++ } }
    $union = $A.Count + $B.Count - $inter
    if ($union -le 0) { return $false }
    return (($inter / $union) -ge 0.72)
}

# 按日期分组 -> 相似度聚类 -> 每组保留最长的
$result = New-Object System.Collections.Generic.List[object]
$byDate = @{}
foreach ($m in $mems) {
    $d = [string]$m.memory_date
    $d = $d -replace '/', '-'
    if ($d -match '^(\d{4})-(\d{1,2})-(\d{1,2})') { $d = "{0}-{1:D2}-{2:D2}" -f $matches[1], [int]$matches[2], [int]$matches[3] }
    if (-not $byDate.ContainsKey($d)) { $byDate[$d] = New-Object System.Collections.Generic.List[object] }
    $byDate[$d].Add([pscustomobject]@{ date = $d; memory = [string]$m.memory; emotion = [string]$m.emotion; state = [string]$m.state; folder = [string]$m.folder })
}

foreach ($d in $byDate.Keys) {
    $clusters = New-Object System.Collections.Generic.List[object]
    foreach ($item in $byDate[$d]) {
        $norm = Normalize $item.memory
        $placed = $false
        foreach ($c in $clusters) {
            if (Similar $norm $c.repNorm) {
                $c.items.Add($item)
                if ($item.memory.Length -gt $c.rep.memory.Length) { $c.rep = $item; $c.repNorm = $norm }
                $placed = $true; break
            }
        }
        if (-not $placed) {
            $c = [pscustomobject]@{ rep = $item; repNorm = $norm; items = (New-Object System.Collections.Generic.List[object]) }
            $c.items.Add($item)
            $clusters.Add($c)
        }
    }
    Write-Host ("   [{0}] {1} 条 -> 去重后 {2} 条" -f $d, $byDate[$d].Count, $clusters.Count) -ForegroundColor Yellow
    foreach ($c in $clusters) { $result.Add($c.rep) }
}

Write-Host ("最终保留 {0} 条" -f $result.Count) -ForegroundColor Green

# 清空云端记忆表（按 id 分批删除，避免一次性超时）
Write-Host "清空云端 cozy_memories ..." -ForegroundColor Cyan
$existing = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?select=id" -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
$ids = @(@($existing) | ForEach-Object { $_.id })
Write-Host ("   现有 {0} 条待删除" -f $ids.Count) -ForegroundColor Cyan
for ($i = 0; $i -lt $ids.Count; $i += 60) {
    $end = [Math]::Min($i + 59, $ids.Count - 1)
    $idList = ($ids[$i..$end] -join ',')
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=in.($idList)" -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 60 | Out-Null
    } catch { Write-Host ("   删除批次失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}

Write-Host "写回 ..." -ForegroundColor Cyan
$n = 0
foreach ($r in $result) {
    $row = @{ memory_date = $r.date; folder = "$($r.date) 手记"; memory = $r.memory; emotion = $r.emotion; state = $r.state } | ConvertTo-Json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($row)
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories" -Method Post -Headers $postHeaders -Body $bytes -UseBasicParsing -TimeoutSec 30 | Out-Null
        $n++
    } catch { Write-Host ("   写入失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}
Write-Host ("已写入 {0} 条" -f $n) -ForegroundColor Green
Write-Host "完成。" -ForegroundColor Green

# ============================================================
#  林间一盏灯 · 聊天记录自动备份脚本
#  从 Supabase 拉取全部聊天记录，按日期整理成记事本(txt)格式
#  输出目录：D:\林间一盏灯_聊天备份
#    ├─ 按日期\        每个日期一个 txt（每天刷新覆盖）
#    ├─ 完整快照\      每次备份一份带时间戳的完整 txt
#    └─ 日志\          运行日志
# ============================================================

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"

$baseDir = "D:\林间一盏灯_聊天备份"
$dayDir  = Join-Path $baseDir "按日期"
$snapDir = Join-Path $baseDir "完整快照"
$logDir  = Join-Path $baseDir "日志"
$keepSnapshots = 60   # 完整快照最多保留多少份

# ---------- 准备目录 ----------
foreach ($d in @($baseDir, $dayDir, $snapDir, $logDir)) {
    if (!(Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$logFile = Join-Path $logDir ("backup_{0:yyyy-MM-dd}.log" -f (Get-Date))
function Write-Log($msg) {
    $line = ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg)
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch {}
}

function ConvertTo-BjTime($iso) {
    if (-not $iso) { return "" }
    try {
        $dto = [System.DateTimeOffset]::Parse($iso)
        return $dto.ToOffset([TimeSpan]::FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss")
    } catch { return "" }
}

Write-Log "================ 开始备份 ================"

# ---------- 从 Supabase 分页拉取全部聊天 ----------
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$all = @()
$offset = 0
$pageSize = 1000

try {
    while ($true) {
        $uri = "$SUPABASE_URL/rest/v1/cozy_chats?select=id,session_id,role,content,created_at&order=id.asc&limit=$pageSize&offset=$offset"
        $resp = Invoke-WebRequest -Uri $uri -Method Get -Headers $headers -UseBasicParsing -TimeoutSec 120
        $batch = $resp.Content | ConvertFrom-Json
        if ($null -eq $batch) { break }
        $batchArr = @($batch)
        if ($batchArr.Count -eq 0) { break }
        foreach ($item in $batchArr) { $all += $item }
        if ($batchArr.Count -lt $pageSize) { break }
        $offset += $pageSize
    }
} catch {
    Write-Log ("❌ 拉取失败: {0}" -f $_.Exception.Message)
    exit 1
}

Write-Log ("拉取到 {0} 条记录" -f $all.Count)

# ---------- 生成按日期的记事本文件 ----------
$grouped = $all | Group-Object session_id
foreach ($g in $grouped) {
    $sid = $g.Name
    if ([string]::IsNullOrWhiteSpace($sid)) { $sid = "未知日期" }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("【$sid 的聊天记录】")
    [void]$sb.AppendLine("导出于 " + (Get-Date -Format "yyyy-MM-dd HH:mm") + "　共 " + $g.Count + " 条")
    [void]$sb.AppendLine(("=" * 60))
    [void]$sb.AppendLine("")

    foreach ($m in ($g.Group | Sort-Object created_at)) {
        $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
        $t = ConvertTo-BjTime $m.created_at
        [void]$sb.AppendLine("[$t] $who：")
        [void]$sb.AppendLine([string]$m.content)
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine(("-" * 40))
        [void]$sb.AppendLine("")
    }

    $safeName = ($sid -replace '[\\/:*?"<>|]', '-')
    $file = Join-Path $dayDir ($safeName + ".txt")
    [System.IO.File]::WriteAllText($file, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
}
Write-Log ("按日期文件已更新：{0} 个" -f $grouped.Count)

# ---------- 生成一份带时间戳的完整快照 ----------
$sbAll = New-Object System.Text.StringBuilder
[void]$sbAll.AppendLine("林间一盏灯 · 完整聊天记录备份")
[void]$sbAll.AppendLine("导出时间：" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
[void]$sbAll.AppendLine("记录总数：" + $all.Count)
[void]$sbAll.AppendLine(("=" * 60))
[void]$sbAll.AppendLine("")

foreach ($g in ($grouped | Sort-Object Name)) {
    $sid = $g.Name
    if ([string]::IsNullOrWhiteSpace($sid)) { $sid = "未知日期" }
    [void]$sbAll.AppendLine("")
    [void]$sbAll.AppendLine("########## $sid （$($g.Count) 条） ##########")
    [void]$sbAll.AppendLine("")
    foreach ($m in ($g.Group | Sort-Object created_at)) {
        $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
        $t = ConvertTo-BjTime $m.created_at
        [void]$sbAll.AppendLine("[$t] $who：")
        [void]$sbAll.AppendLine([string]$m.content)
        [void]$sbAll.AppendLine("")
    }
}

$snapFile = Join-Path $snapDir ("完整聊天记录_{0:yyyy-MM-dd_HHmm}.txt" -f (Get-Date))
[System.IO.File]::WriteAllText($snapFile, $sbAll.ToString(), (New-Object System.Text.UTF8Encoding($true)))
# 同时维护一份“最新”副本，方便随时打开
$latestFile = Join-Path $baseDir "最新完整备份.txt"
[System.IO.File]::WriteAllText($latestFile, $sbAll.ToString(), (New-Object System.Text.UTF8Encoding($true)))
Write-Log ("完整快照已保存：{0}" -f $snapFile)

# ---------- 清理过旧快照，避免占满 D 盘 ----------
try {
    $snaps = Get-ChildItem -LiteralPath $snapDir -Filter "*.txt" | Sort-Object LastWriteTime -Descending
    if ($snaps.Count -gt $keepSnapshots) {
        $snaps | Select-Object -Skip $keepSnapshots | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
        }
        Write-Log ("已清理超出 {0} 份的旧快照" -f $keepSnapshots)
    }
} catch { Write-Log ("清理快照失败: {0}" -f $_.Exception.Message) }

Write-Log "================ 备份完成 ================"

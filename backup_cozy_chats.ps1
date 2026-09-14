# ============================================================
#  林间一盏灯 · 每日备份（聊天记录 + 庇护所记忆）
#  由 Windows 计划任务每天 05:00 自动运行
#  输出：D:\林间一盏灯_聊天备份
#    ├─ 按日期\           每天聊天记录 txt
#    ├─ 完整快照\         每次带时间戳的完整 txt
#    ├─ 庇护所记忆\       每天一份记忆总结 txt（一天一个文件）
#    └─ 日志\
# ============================================================
$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$API_URL   = "https://shufulei.net/v1/chat/completions"
$API_KEY   = "fHHaJSoscSQPLyygDFWvE9SvoM7CN3Z3i1BpbTiMwNTtbjx0"
$API_MODEL = "[企业cli-0.01]gemini-3.5-flash"

$baseDir = "D:\林间一盏灯_聊天备份"
$dayDir  = Join-Path $baseDir "按日期"
$snapDir = Join-Path $baseDir "完整快照"
$memDir  = Join-Path $baseDir "庇护所记忆"
$logDir  = Join-Path $baseDir "日志"
$keepSnapshots = 60

foreach ($d in @($baseDir, $dayDir, $snapDir, $memDir, $logDir)) {
    if (!(Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$logFile = Join-Path $logDir ("backup_{0:yyyy-MM-dd}.log" -f (Get-Date))
function Write-Log($msg) {
    $line = ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg)
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch {}
}
function ConvertTo-BjTime($iso) {
    if (-not $iso) { return "" }
    try { return ([System.DateTimeOffset]::Parse($iso)).ToOffset([TimeSpan]::FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss") } catch { return "" }
}
function Get-CozySessionId([datetime]$utc) {
    $bj = $utc.AddHours(8)
    if ($bj.Hour -lt 5) { $bj = $bj.AddDays(-1) }
    return $bj.ToString("yyyy-MM-dd")
}

$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$jsonPost = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "application/json" }

Write-Log "================ 开始备份 ================"

# ---------- 拉取全部聊天 ----------
$chats = New-Object System.Collections.Generic.List[object]
$offset = 0; $pageSize = 1000
try {
    while ($true) {
        $uri = "$SUPABASE_URL/rest/v1/cozy_chats?select=id,session_id,role,content,created_at&order=id.asc&limit=$pageSize&offset=$offset"
        $batch = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 120).Content | ConvertFrom-Json
        $arr = @($batch)
        if ($arr.Count -eq 0) { break }
        foreach ($it in $arr) { [void]$chats.Add($it) }
        if ($arr.Count -lt $pageSize) { break }
        $offset += $pageSize
    }
} catch {
    Write-Log ("❌ 拉取聊天失败: {0}" -f $_.Exception.Message); exit 1
}
Write-Log ("拉取到 {0} 条聊天记录" -f $chats.Count)

# ---------- 按日期导出 txt ----------
$grouped = $chats | Group-Object session_id
foreach ($g in $grouped) {
    $sid = $g.Name
    if ([string]::IsNullOrWhiteSpace($sid)) { $sid = "未知日期" }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("【$sid 的聊天记录】")
    [void]$sb.AppendLine("导出于 " + (Get-Date -Format "yyyy-MM-dd HH:mm") + "　共 " + $g.Count + " 条")
    [void]$sb.AppendLine(("=" * 60)); [void]$sb.AppendLine("")
    foreach ($m in ($g.Group | Sort-Object created_at)) {
        $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
        [void]$sb.AppendLine("[" + (ConvertTo-BjTime $m.created_at) + "] $who：")
        [void]$sb.AppendLine([string]$m.content)
        [void]$sb.AppendLine(""); [void]$sb.AppendLine(("-" * 40)); [void]$sb.AppendLine("")
    }
    $safeName = ($sid -replace '[\\/:*?"<>|]', '-')
    [System.IO.File]::WriteAllText((Join-Path $dayDir ($safeName + ".txt")), $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
}
Write-Log ("按日期文件已更新：{0} 个" -f $grouped.Count)

# ---------- 完整快照 ----------
$sbAll = New-Object System.Text.StringBuilder
[void]$sbAll.AppendLine("林间一盏灯 · 完整聊天记录备份")
[void]$sbAll.AppendLine("导出时间：" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
[void]$sbAll.AppendLine("记录总数：" + $chats.Count)
[void]$sbAll.AppendLine(("=" * 60)); [void]$sbAll.AppendLine("")
foreach ($g in ($grouped | Sort-Object Name)) {
    $sid = $g.Name; if ([string]::IsNullOrWhiteSpace($sid)) { $sid = "未知日期" }
    [void]$sbAll.AppendLine(""); [void]$sbAll.AppendLine("########## $sid （$($g.Count) 条） ##########"); [void]$sbAll.AppendLine("")
    foreach ($m in ($g.Group | Sort-Object created_at)) {
        $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
        [void]$sbAll.AppendLine("[" + (ConvertTo-BjTime $m.created_at) + "] $who：")
        [void]$sbAll.AppendLine([string]$m.content); [void]$sbAll.AppendLine("")
    }
}
[System.IO.File]::WriteAllText((Join-Path $snapDir ("完整聊天记录_{0:yyyy-MM-dd_HHmm}.txt" -f (Get-Date))), $sbAll.ToString(), (New-Object System.Text.UTF8Encoding($true)))
[System.IO.File]::WriteAllText((Join-Path $baseDir "最新完整备份.txt"), $sbAll.ToString(), (New-Object System.Text.UTF8Encoding($true)))
Write-Log "完整快照已保存"

# ---------- 生成"昨天的庇护所记忆"（若尚未生成）----------
try {
    $utcNow = (Get-Date).ToUniversalTime()
    $todaySid = Get-CozySessionId $utcNow
    $prevSid = ([datetime]::ParseExact($todaySid, 'yyyy-MM-dd', $null)).AddDays(-1).ToString('yyyy-MM-dd')

    $checkUri = "$SUPABASE_URL/rest/v1/cozy_memories?memory_date=eq.$prevSid&select=id&limit=1"
    $exist = (Invoke-WebRequest -Uri $checkUri -Headers $headers -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
    $existCount = @($exist).Count

    if ($existCount -eq 0) {
        $dayChats = @($chats | Where-Object { $_.session_id -eq $prevSid })
        if ($dayChats.Count -ge 2) {
            Write-Log ("正在为 {0} 生成庇护所记忆..." -f $prevSid)
            $lines = foreach ($m in ($dayChats | Sort-Object created_at)) {
                $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
                $c = [string]$m.content
                $c = $c -replace '\[LinesImage:[^\]]*\]', '[图片]'
                $c = $c -replace '\[SHOW_IMAGE:[^\]]*\]', ''
                "$who：$c"
            }
            $historyText = ($lines -join "`n")
            if ($historyText.Length -gt 20000) { $historyText = $historyText.Substring(0, 20000) }

            $prompt = @"
请仔细分析下面这段我（小千）和线条在 ${prevSid} 的聊天记录：
======================
$historyText
======================

请必须从上面的手记里，提炼出这一天的记忆卡片。请务必尽可能全面地保留具体细节，尤其是她的个人喜好、重要经历、承诺过的事情、生活状态等。
不要只写一句笼统的总结！请把这些细节合并成一段详细的话。
你必须只返回标准的 JSON 数据，不要有任何多余的解释，格式严格为：
{"memory": "详细记录多条核心事实的陈述句", "emotion": "[情绪打分，如 欣慰: 95%]", "state": "温柔陪伴"}
"@

            $bodyJson = (@{ model = $API_MODEL; messages = @(@{ role = "user"; content = $prompt }) }) | ConvertTo-Json -Depth 6
            $resp = Invoke-RestMethod -Uri $API_URL -Method Post -Headers @{ Authorization = "Bearer $API_KEY"; "Content-Type" = "application/json" } -Body $bodyJson -TimeoutSec 120
            $raw = [string]$resp.choices[0].message.content

            $jsonMem = $null
            try {
                $cleaned = $raw -replace '```json', '' -replace '```', ''
                $m2 = [regex]::Match($cleaned, '\{[\s\S]*\}')
                if ($m2.Success) { $jsonMem = $m2.Value | ConvertFrom-Json }
            } catch { $jsonMem = $null }

            if ($jsonMem -and $jsonMem.memory) {
                $insBody = @{ memory_date = $prevSid; folder = "$prevSid 手记"; memory = $jsonMem.memory; emotion = $jsonMem.emotion; state = $jsonMem.state } | ConvertTo-Json
                Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories" -Method Post -Headers $jsonPost -Body $insBody -UseBasicParsing -TimeoutSec 60 | Out-Null
                Write-Log ("{0} 的庇护所记忆已生成并写入云端" -f $prevSid)
            } else {
                Write-Log "记忆 JSON 解析失败，跳过"
            }
        } else {
            Write-Log ("{0} 记录不足 2 条，跳过记忆生成" -f $prevSid)
        }
    } else {
        Write-Log ("{0} 已有庇护所记忆，跳过" -f $prevSid)
    }
} catch {
    Write-Log ("生成庇护所记忆失败: {0}" -f $_.Exception.Message)
}

# ---------- 导出庇护所记忆为文件夹（一天一个 txt）----------
try {
    $memUri = "$SUPABASE_URL/rest/v1/cozy_memories?select=*&order=memory_date.asc"
    $mems = (Invoke-WebRequest -Uri $memUri -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    $memCount = 0
    foreach ($mem in @($mems)) {
        $date = if ($mem.memory_date) { [string]$mem.memory_date } else { "未知日期" }
        if ($date -match '^(\d{4})-(\d{1,2})-(\d{1,2})') {
            $date = "{0}-{1:D2}-{2:D2}" -f $matches[1], [int]$matches[2], [int]$matches[3]
        }
        $safe = ($date -replace '[\\/:*?"<>|]', '-')
        $sb = New-Object System.Text.StringBuilder
        [void]$sb.AppendLine("【庇护所记忆 · $safe】")
        [void]$sb.AppendLine(("=" * 60)); [void]$sb.AppendLine("")
        [void]$sb.AppendLine("🧠 核心记忆：")
        [void]$sb.AppendLine([string]$mem.memory)
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("🎭 情感偏置：" + [string]$mem.emotion)
        [void]$sb.AppendLine("🌱 状态：" + [string]$mem.state)
        [System.IO.File]::WriteAllText((Join-Path $memDir ($safe + ".txt")), $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
        $memCount++
    }
    Write-Log ("庇护所记忆已导出：{0} 个文件" -f $memCount)
} catch {
    Write-Log ("导出庇护所记忆失败: {0}" -f $_.Exception.Message)
}

# ---------- 清理过旧快照 ----------
try {
    $snaps = Get-ChildItem -LiteralPath $snapDir -Filter "*.txt" | Sort-Object LastWriteTime -Descending
    if ($snaps.Count -gt $keepSnapshots) { $snaps | Select-Object -Skip $keepSnapshots | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force } }
} catch {}

Write-Log "================ 备份完成 ================"

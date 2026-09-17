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
# 🔑 不硬写 Key：优先读环境变量 SHUFULEI_API_KEY，其次读同目录的 .shufulei_key（已被 gitignore）
$API_KEY = $env:SHUFULEI_API_KEY
if (-not $API_KEY) {
    $__kf = Join-Path $PSScriptRoot ".shufulei_key"
    if (Test-Path -LiteralPath $__kf) { $API_KEY = (Get-Content -LiteralPath $__kf -Raw -Encoding UTF8).Trim() }
}
if (-not $API_KEY) { Write-Host "⚠️ 未找到舒芙蕾 API Key（同目录 .shufulei_key 或环境变量 SHUFULEI_API_KEY）——文件备份照常，AI 记忆生成会跳过。" -ForegroundColor Yellow }
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
$delHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal" }

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
请仔细阅读下面这段「小千」和「线条」在 ${prevSid} 的聊天记录，提炼当天的记忆卡片。
要求：
- 按【话题】拆成若干条（3~8 条），例如：生活状态 / 学习工作 / 兴趣爱好 / 情感与关系 / 计划与承诺 / 喜好清单…
- 每条 40~120 字，尽量保留具体细节（人名、地点、时间、书名、歌名、口味、承诺等）
- 不同条目之间不要重复同一件事；宁缺毋滥
只返回标准 JSON 数组，不要解释或 markdown 标记，格式严格为：
[{"topic":"话题名","memory":"该话题的详细记忆","emotion":"[情绪打分，如 欣慰: 95%]","state":"温柔陪伴"}]

聊天记录：
======================
$historyText
======================
"@

            $bodyJson = (@{ model = $API_MODEL; messages = @(@{ role = "user"; content = $prompt }) }) | ConvertTo-Json -Depth 6
            $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
            $resp = Invoke-RestMethod -Uri $API_URL -Method Post -Headers @{ Authorization = "Bearer $API_KEY"; "Content-Type" = "application/json; charset=utf-8" } -Body $bodyBytes -TimeoutSec 120
            $raw = [string]$resp.choices[0].message.content

            $arr = $null
            try {
                $cleaned = $raw -replace '```json', '' -replace '```', ''
                $m2 = [regex]::Match($cleaned, '\[[\s\S]*\]')
                if ($m2.Success) { $arr = $m2.Value | ConvertFrom-Json }
            } catch { $arr = $null }

            if ($arr) {
                # 先清掉这一天的旧记忆，再写入新的话题集合
                $old = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?memory_date=eq.$prevSid&select=id" -Headers $headers -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
                $oldIds = @(@($old) | ForEach-Object { $_.id })
                for ($k = 0; $k -lt $oldIds.Count; $k += 60) {
                    $end = [Math]::Min($k + 59, $oldIds.Count - 1)
                    $idList = ($oldIds[$k..$end] -join ',')
                    try { Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=in.($idList)" -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 30 | Out-Null } catch {}
                }
                $cnt = 0
                foreach ($t in @($arr)) {
                    if (-not $t -or -not $t.memory) { continue }
                    $row = @{ memory_date = $prevSid; folder = "$prevSid 手记 · $($t.topic)"; memory = [string]$t.memory; emotion = [string]$t.emotion; state = [string]$t.state } | ConvertTo-Json
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($row)
                    try { Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories" -Method Post -Headers $jsonPost -Body $bytes -UseBasicParsing -TimeoutSec 60 | Out-Null; $cnt++ } catch {}
                }
                Write-Log ("{0} 的庇护所记忆已按话题生成 {1} 条" -f $prevSid, $cnt)
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

# ---------- 抽取"昨天的事实碎片"（若尚未抽取）----------
try {
    $utcNow2 = (Get-Date).ToUniversalTime()
    $todaySid2 = Get-CozySessionId $utcNow2
    $prevSid2 = ([datetime]::ParseExact($todaySid2, 'yyyy-MM-dd', $null)).AddDays(-1).ToString('yyyy-MM-dd')

    $factCheck = "$SUPABASE_URL/rest/v1/cozy_facts?fact_date=eq.$prevSid2&select=id&limit=1"
    $factExist = (Invoke-WebRequest -Uri $factCheck -Headers $headers -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
    if (@($factExist).Count -eq 0) {
        $dayChats2 = @($chats | Where-Object { $_.session_id -eq $prevSid2 })
        if ($dayChats2.Count -ge 2) {
            $lines2 = foreach ($m in ($dayChats2 | Sort-Object created_at)) {
                $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
                $c = [string]$m.content
                $c = $c -replace '\[LinesImage:[^\]]*\]', '[图片]'
                $c = $c -replace '\[SHOW_IMAGE:[^\]]*\]', ''
                "$who：$c"
            }
            $ht2 = ($lines2 -join "`n")
            if ($ht2.Length -gt 20000) { $ht2 = $ht2.Substring($ht2.Length - 20000) }

            $fp = @"
请从下面这段「小千」和「线条」的聊天记录里，抽取对长期陪伴有用的事实碎片。
每条事实是一个第三人称短句（不超过40字），描述关于线条（或你们之间）的人、地点、事件、兴趣、偏好、重要承诺。
忽略寒暄、临时情绪和无关内容。宁缺毋滥，最多12条。
聊天记录：
======================
$ht2
======================
你必须只返回标准 JSON 数组，不要任何解释或 markdown 标记，格式严格为：
[{"category":"人物/地点/事件/兴趣/偏好/其他","subject":"主体","fact":"事实短句","keywords":"逗号分隔的关键词"}]
"@
            $bodyJson2 = (@{ model = $API_MODEL; messages = @(@{ role = "user"; content = $fp }) }) | ConvertTo-Json -Depth 6
            $resp2 = Invoke-RestMethod -Uri $API_URL -Method Post -Headers @{ Authorization = "Bearer $API_KEY"; "Content-Type" = "application/json" } -Body $bodyJson2 -TimeoutSec 120
            $raw2 = [string]$resp2.choices[0].message.content
            $fa = $null
            try {
                $cleaned2 = $raw2 -replace '```json', '' -replace '```', ''
                $mm2 = [regex]::Match($cleaned2, '\[[\s\S]*\]')
                if ($mm2.Success) { $fa = $mm2.Value | ConvertFrom-Json }
            } catch { $fa = $null }
            $cnt = 0
            foreach ($f in @($fa)) {
                if ($f -and $f.fact) {
                    $row = @{ fact_date = $prevSid2; category = [string]$f.category; subject = [string]$f.subject; fact = [string]$f.fact; keywords = [string]$f.keywords } | ConvertTo-Json
                    try {
                        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_facts" -Method Post -Headers $jsonPost -Body $row -UseBasicParsing -TimeoutSec 30 | Out-Null
                        $cnt++
                    } catch {}
                }
            }
            Write-Log ("{0} 的事实碎片已抽取：{1} 条" -f $prevSid2, $cnt)
        } else {
            Write-Log ("{0} 记录不足，跳过事实抽取" -f $prevSid2)
        }
    } else {
        Write-Log ("{0} 已有事实碎片，跳过" -f $prevSid2)
    }
} catch {
    Write-Log ("抽取事实碎片失败: {0}" -f $_.Exception.Message)
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

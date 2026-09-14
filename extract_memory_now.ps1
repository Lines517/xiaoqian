# ============================================================
#  ① 验证图床桶  ② 抽取"今天"的话题记忆
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$EDGE_FN = "$SUPABASE_URL/functions/v1/chat"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$jsonPost = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "application/json" }
$delHeaders = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; Prefer = "return=minimal" }

function Get-CozySessionId([datetime]$utc) {
    $bj = $utc.AddHours(8)
    if ($bj.Hour -lt 5) { $bj = $bj.AddDays(-1) }
    return $bj.ToString("yyyy-MM-dd")
}
$sid = Get-CozySessionId (Get-Date).ToUniversalTime()
Write-Host ("会话日期: {0}" -f $sid) -ForegroundColor Cyan

# ---------- ① 验证图床桶（上传+删除一个测试文件）----------
Write-Host "① 验证图床桶 cozy-media ..." -ForegroundColor Cyan
try {
    $testBytes = [System.Text.Encoding]::UTF8.GetBytes("ping")
    $up = Invoke-WebRequest -Uri "$SUPABASE_URL/storage/v1/object/cozy-media/_selftest/ping.txt" -Method Post -Headers @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "text/plain"; "x-upsert" = "true" } -Body $testBytes -UseBasicParsing -TimeoutSec 30
    Write-Host ("   上传成功 (HTTP {0})" -f $up.StatusCode) -ForegroundColor Green
    Invoke-WebRequest -Uri "$SUPABASE_URL/storage/v1/object/cozy-media/_selftest/ping.txt" -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 30 | Out-Null
    Write-Host "   测试文件已删除，图床可用 ✅" -ForegroundColor Green
} catch {
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); Write-Host ("   ❌ 图床不可用: " + $sr.ReadToEnd()) -ForegroundColor Red } catch { Write-Host ("   ❌ 图床不可用: " + $_.Exception.Message) -ForegroundColor Red }
}

# ---------- ② 拉取今天的聊天 ----------
Write-Host "② 拉取今天的聊天记录 ..." -ForegroundColor Cyan
$chats = New-Object System.Collections.Generic.List[object]
$offset = 0
while ($true) {
    $uri = "$SUPABASE_URL/rest/v1/cozy_chats?session_id=eq.$sid&select=role,content&order=created_at.asc&limit=1000&offset=$offset"
    $batch = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
    $arr = @($batch)
    if ($arr.Count -eq 0) { break }
    foreach ($it in $arr) { [void]$chats.Add($it) }
    if ($arr.Count -lt 1000) { break }
    $offset += 1000
}
Write-Host ("   共 {0} 条" -f $chats.Count) -ForegroundColor Green
if ($chats.Count -lt 2) { Write-Host "记录太少，跳过记忆抽取"; exit 0 }

$lines = foreach ($m in $chats) {
    $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
    $c = [string]$m.content
    $c = $c -replace '\[LinesImage:[^\]]*\]', '[图片]'
    $c = $c -replace '\[SHOW_IMAGE:[^\]]*\]', ''
    "$who：$c"
}
$historyText = ($lines -join "`n")
if ($historyText.Length -gt 20000) { $historyText = $historyText.Substring($historyText.Length - 20000) }

$prompt = @"
请仔细阅读下面这段「小千」和「线条」在 ${sid} 的聊天记录，提炼当天的记忆卡片。
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

Write-Host "③ 调用模型按话题提炼 ..." -ForegroundColor Cyan
$bodyJson = (@{ model = "[企业cli-0.01]gemini-3.5-flash"; messages = @(@{ role = "user"; content = $prompt }); stream = $true }) | ConvertTo-Json -Depth 6
$tmpReq = "C:\Users\86188\AppData\Local\Temp\opencode\mem_req.json"
$tmpResp = "C:\Users\86188\AppData\Local\Temp\opencode\mem_resp.txt"
[System.IO.File]::WriteAllText($tmpReq, $bodyJson, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -o $tmpResp -X POST $EDGE_FN -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" --data-binary "@$tmpReq" --max-time 180
$sse = [System.IO.File]::ReadAllText($tmpResp, [System.Text.Encoding]::UTF8)
$full = ""
foreach ($line in ($sse -split "`n")) {
    $l = $line.Trim()
    if (-not $l.StartsWith("data:")) { continue }
    $d = $l.Substring(5).Trim()
    if ($d -eq "[DONE]") { continue }
    try { $p = $d | ConvertFrom-Json; if ($p.choices[0].delta.content) { $full += $p.choices[0].delta.content } } catch {}
}
$full = $full.Trim()

$arr = $null
try {
    $mm = [regex]::Match(($full -replace '```json','' -replace '```',''), '\[[\s\S]*\]')
    if ($mm.Success) { $arr = $mm.Value | ConvertFrom-Json }
} catch { $arr = $null }
if (-not $arr) { Write-Host "❌ 解析失败，模型原始输出：" -ForegroundColor Red; Write-Host $full; exit 1 }

# ---------- ④ 清掉今天旧记忆，写入新的话题记忆 ----------
Write-Host "④ 写入云端 ..." -ForegroundColor Cyan
$old = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?memory_date=eq.$sid&select=id" -Headers $headers -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
$oldIds = @(@($old) | ForEach-Object { $_.id })
for ($k = 0; $k -lt $oldIds.Count; $k += 60) {
    $end = [Math]::Min($k + 59, $oldIds.Count - 1)
    $idList = ($oldIds[$k..$end] -join ',')
    try { Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories?id=in.($idList)" -Method Delete -Headers $delHeaders -UseBasicParsing -TimeoutSec 30 | Out-Null } catch {}
}
$n = 0
$out = New-Object System.Text.StringBuilder
foreach ($t in @($arr)) {
    if (-not $t -or -not $t.memory) { continue }
    $row = @{ memory_date = $sid; folder = "$sid 手记 · $($t.topic)"; memory = [string]$t.memory; emotion = [string]$t.emotion; state = [string]$t.state } | ConvertTo-Json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($row)
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_memories" -Method Post -Headers $jsonPost -Body $bytes -UseBasicParsing -TimeoutSec 60 | Out-Null
        [void]$out.AppendLine("【$($t.topic)】$($t.memory)")
        [void]$out.AppendLine("")
        $n++
    } catch { Write-Host ("   写入失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}
$resultFile = "C:\Users\86188\AppData\Local\Temp\opencode\extracted_memory.txt"
[System.IO.File]::WriteAllText($resultFile, $out.ToString(), (New-Object System.Text.UTF8Encoding($true)))
Write-Host ("✅ 已为 {0} 写入 {1} 条话题记忆，已保存到 {2}" -f $sid, $n, $resultFile) -ForegroundColor Green

# ============================================================
#  林间一盏灯 · 补齐历史日期的"事实碎片"
#  逐天检查 cozy_facts，没有的就调用 AI 抽取并写入
# ============================================================
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$API_URL   = "https://shufulei.net/v1/chat/completions"
$API_KEY   = "fHHaJSoscSQPLyygDFWvE9SvoM7CN3Z3i1BpbTiMwNTtbjx0"
$API_MODEL = "[企业cli-0.01]gemini-3.5-flash"

$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }
$jsonPost = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "application/json" }

Write-Host "① 拉取全部聊天 ..." -ForegroundColor Cyan
$chats = New-Object System.Collections.Generic.List[object]
$offset = 0; $pageSize = 1000
while ($true) {
    $uri = "$SUPABASE_URL/rest/v1/cozy_chats?select=id,session_id,role,content,created_at&order=id.asc&limit=$pageSize&offset=$offset"
    $batch = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 120).Content | ConvertFrom-Json
    $arr = @($batch)
    if ($arr.Count -eq 0) { break }
    foreach ($it in $arr) { [void]$chats.Add($it) }
    if ($arr.Count -lt $pageSize) { break }
    $offset += $pageSize
}
Write-Host ("   共 {0} 条" -f $chats.Count) -ForegroundColor Green

Write-Host "② 检查已有的 fact_date ..." -ForegroundColor Cyan
$existing = (Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_facts?select=fact_date" -Headers $headers -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
$done = @{}
foreach ($e in @($existing)) { if ($e.fact_date) { $done[[string]$e.fact_date] = $true } }
Write-Host ("   已抽过: {0} 天" -f $done.Count) -ForegroundColor Green

$days = ($chats | Group-Object session_id | Sort-Object Name)
Write-Host ("③ 共 {0} 天待检查" -f $days.Count) -ForegroundColor Cyan

foreach ($g in $days) {
    $sid = $g.Name
    if ([string]::IsNullOrWhiteSpace($sid)) { continue }
    if ($done.ContainsKey($sid)) { Write-Host ("   [$sid] 已有，跳过") -ForegroundColor DarkGray; continue }
    if ($g.Count -lt 2) { Write-Host ("   [$sid] 记录不足，跳过") -ForegroundColor DarkGray; continue }

    Write-Host ("   [$sid] 抽取中...") -ForegroundColor Yellow
    $lines = foreach ($m in ($g.Group | Sort-Object created_at)) {
        $who = if ($m.role -eq 'user') { '线条' } else { '小千' }
        $c = [string]$m.content
        $c = $c -replace '\[LinesImage:[^\]]*\]', '[图片]'
        $c = $c -replace '\[SHOW_IMAGE:[^\]]*\]', ''
        "$who：$c"
    }
    $ht = ($lines -join "`n")
    if ($ht.Length -gt 12000) { $ht = $ht.Substring($ht.Length - 12000) }

    $fp = @"
请从下面这段「小千」和「线条」的聊天记录里，抽取对长期陪伴有用的事实碎片。
每条事实是一个第三人称短句（不超过40字），描述关于线条（或你们之间）的人、地点、事件、兴趣、偏好、重要承诺。
忽略寒暄、临时情绪和无关内容。宁缺毋滥，最多12条。
聊天记录：
======================
$ht
======================
你必须只返回标准 JSON 数组，不要任何解释或 markdown 标记，格式严格为：
[{"category":"人物/地点/事件/兴趣/偏好/其他","subject":"主体","fact":"事实短句","keywords":"逗号分隔的关键词"}]
"@
    try {
        $bodyJson = (@{ model = $API_MODEL; messages = @(@{ role = "user"; content = $fp }) }) | ConvertTo-Json -Depth 6
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
        $resp = $null
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                $resp = Invoke-RestMethod -Uri $API_URL -Method Post -Headers @{ Authorization = "Bearer $API_KEY"; "Content-Type" = "application/json; charset=utf-8" } -Body $bodyBytes -TimeoutSec 120
                break
            } catch {
                Write-Host ("     第 {0} 次失败，重试中..." -f $attempt) -ForegroundColor DarkYellow
                Start-Sleep -Seconds 6
            }
        }
        if ($null -eq $resp) { throw "AI 调用三次均失败" }
        $raw = [string]$resp.choices[0].message.content
        $fa = $null
        try {
            $cleaned = $raw -replace '```json', '' -replace '```', ''
            $mm = [regex]::Match($cleaned, '\[[\s\S]*\]')
            if ($mm.Success) { $fa = $mm.Value | ConvertFrom-Json }
        } catch { $fa = $null }
        $cnt = 0
        foreach ($f in @($fa)) {
            if ($f -and $f.fact) {
                $row = @{ fact_date = $sid; category = [string]$f.category; subject = [string]$f.subject; fact = [string]$f.fact; keywords = [string]$f.keywords } | ConvertTo-Json
                try {
                    Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_facts" -Method Post -Headers $jsonPost -Body $row -UseBasicParsing -TimeoutSec 30 | Out-Null
                    $cnt++
                } catch {}
            }
        }
        Write-Host ("   [$sid] 已写入 {0} 条事实" -f $cnt) -ForegroundColor Green
    } catch {
        Write-Host ("   [$sid] 抽取失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host "完成。" -ForegroundColor Green

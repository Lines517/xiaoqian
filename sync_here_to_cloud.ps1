# ============================================================
#  把"这里"（命令行里的对话）同步进云端 cozy_chats
#  用法：传入一个 JSON 文件，内容为 [{ "role":"user|assistant", "content":"..." }, ...]
#  会自动归到当前的"小千日"（北京时间，凌晨5点为界）
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$JsonFile
)
$ErrorActionPreference = 'Stop'
$SUPABASE_URL = "https://kejcaijcqlfmtlfxktrk.supabase.co"
$SUPABASE_KEY = "sb_publishable_xa16IttRP-xHQdHSiDNCsA_3dOlQutU"
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY"; "Content-Type" = "application/json"; Prefer = "return=minimal" }

function Get-CozySessionId([datetime]$utc) {
    $bj = $utc.AddHours(8)
    if ($bj.Hour -lt 5) { $bj = $bj.AddDays(-1) }
    return $bj.ToString("yyyy-MM-dd")
}
$sid = Get-CozySessionId (Get-Date).ToUniversalTime()

$parsed = (Get-Content -LiteralPath $JsonFile -Raw -Encoding UTF8) | ConvertFrom-Json
$msgs = @($parsed)
Write-Host ("会话日期: {0}，共 {1} 条待同步" -f $sid, $msgs.Count) -ForegroundColor Cyan

$n = 0
foreach ($m in $msgs) {
    if (-not $m.role -or -not $m.content) { continue }
    $row = @{ session_id = $sid; role = [string]$m.role; content = [string]$m.content } | ConvertTo-Json
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($row)
    try {
        Invoke-WebRequest -Uri "$SUPABASE_URL/rest/v1/cozy_chats" -Method Post -Headers $headers -Body $bytes -UseBasicParsing -TimeoutSec 60 | Out-Null
        $n++
    } catch { Write-Host ("  失败: {0}" -f $_.Exception.Message) -ForegroundColor Red }
}
Write-Host ("已同步 {0} 条" -f $n) -ForegroundColor Green

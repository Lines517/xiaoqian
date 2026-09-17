# ============================================================
#  小千 · 舒芙蕾 API Key 设置工具
#  作用：把新 Key 写入 C:\Users\86188\Desktop\my_cozy_space\.shufulei_key
#        （这个文件已被 gitignore，永远不会被上传到 GitHub）
#  用法：双击桌面上的「设置小千的Key.bat」
# ============================================================
$ErrorActionPreference = 'Stop'
$target = "C:\Users\86188\Desktop\my_cozy_space\.shufulei_key"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   设置小千的舒芙蕾 API Key" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "把【新的 Key】粘贴进来，然后按回车。" -ForegroundColor White
Write-Host "（粘贴后如果看不见字，是正常的；直接回车即可）" -ForegroundColor DarkGray
Write-Host ""

$k = Read-Host "新 Key"
if ([string]::IsNullOrWhiteSpace($k)) {
    Write-Host ""
    Write-Host "没有输入内容，已取消（什么都没改）。" -ForegroundColor Yellow
    exit 1
}
$k = $k.Trim()

# 写入（UTF-8 无 BOM，一行）
[System.IO.File]::WriteAllText($target, $k, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host ("✅ 已保存到: " + $target) -ForegroundColor Green
Write-Host ("   Key 长度 " + $k.Length + " 位，开头是: " + $k.Substring(0, [Math]::Min(6, $k.Length)) + "…") -ForegroundColor Gray
Write-Host ""
Write-Host "顺手测一下这把 Key 能不能用……" -ForegroundColor Cyan

try {
    $body = @{ model = "[企业cli-0.01]gemini-3.5-flash"; messages = @(@{ role = "user"; content = "只回四个字：我在听着" }) } | ConvertTo-Json -Depth 6
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $r = Invoke-RestMethod -Uri "https://shufulei.net/v1/chat/completions" -Method Post `
        -Headers @{ Authorization = "Bearer $k"; "Content-Type" = "application/json" } `
        -Body $bytes -TimeoutSec 60
    $t = [string]$r.choices[0].message.content
    Write-Host ""
    Write-Host ("✅ 测试通过！模型回了你一句: " + $t.Trim()) -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host ("⚠️ 测试没通过: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host "   （Key 已经保存好了。如果是 401/未授权，多半是复制时漏了字符，重跑一次即可）" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "别忘了还有一步：Supabase → Edge Functions → Secrets → 把 MODEL_API_KEY 也换成这把新 Key。" -ForegroundColor Yellow
Write-Host ""

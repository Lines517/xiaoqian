# ============================================================
#  flush_memory.ps1 —— 命令行会话「一键上传记忆」
#  做的事：
#    ① 把本次会话（JSON 批文件）去重写入云端 cozy_chats
#    ② 按话题重新抽取"今天"的记忆，写入 cozy_memories
#  用法：
#    powershell -ExecutionPolicy Bypass -File flush_memory.ps1 -JsonFile C:\path\batch.json
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$JsonFile
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

Write-Host "=========== ① 上传会话到云端 ===========" -ForegroundColor Magenta
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$here\sync_here_to_cloud.ps1" -JsonFile $JsonFile

Write-Host ""
Write-Host "=========== ② 重新抽取今日记忆 ===========" -ForegroundColor Magenta
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$here\extract_memory_now.ps1"

Write-Host ""
Write-Host "✅ 完成：网页端刷新后即可读到你今天在这里说的话。" -ForegroundColor Green

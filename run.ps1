<#
.SYNOPSIS
  Serve the learning app locally (no Docker, no installs). Run it from the VS Code terminal.

.EXAMPLE
  .\run.ps1                 # http://localhost:8080 and open the browser
  .\run.ps1 -Port 9000      # use another port
  .\run.ps1 -NoBrowser      # don't open the browser
  Press Ctrl+C to stop.
#>
param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.js'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json';         '.svg' = 'image/svg+xml'
  '.png'  = 'image/png';  '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif';  '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
  '.woff' = 'font/woff';  '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch { throw "Could not listen on port $Port (already in use?). Try: .\run.ps1 -Port 9000" }

$url = "http://localhost:$Port/"
Write-Host "Learning app running at $url   (Ctrl+C to stop)"
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    # Wait in short slices so Ctrl+C is handled promptly.
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(250)) { }
    $ctx = $task.GetAwaiter().GetResult()
    $res = $ctx.Response

    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))

      # Stay inside the project folder.
      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      } else {
        if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
        if (Test-Path $path -PathType Leaf) {
          $ext = [IO.Path]::GetExtension($path).ToLower()
          $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
          $res.Headers['Cache-Control'] = 'no-cache'   # edits show up on refresh
          $bytes = [IO.File]::ReadAllBytes($path)
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
          $res.StatusCode = 404
        }
      }
      Write-Host ("{0} {1} {2}" -f $res.StatusCode, $ctx.Request.HttpMethod, $ctx.Request.Url.AbsolutePath)
    }
    catch { $res.StatusCode = 500 }
    finally { $res.Close() }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
  Write-Host 'Stopped.'
}

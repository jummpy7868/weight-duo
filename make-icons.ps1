# 從 icon-src.png 產生 PWA 圖示（來源可以是 JPEG，副檔名不重要）。
# 環境沒有 ImageMagick，用 Windows 內建的 System.Drawing 解碼 + 高品質縮放。
# 改圖示 = 換掉 icon-src.png 再跑這支，不要手動編輯輸出的 PNG。
#
# 為什麼主體包在 here-string 裡再 Invoke-Expression：
# Windows PowerShell 5.1 會「先解析整個檔案、才開始執行」，
# 所以檔案裡的 [System.Drawing.X] 在 Add-Type 跑到之前就要被解析 → Unable to find type。
# （同一段程式碼直接貼進 shell 逐句執行反而沒事，很容易誤判成環境壞掉。）
# 字串裡的內容要等 Invoke-Expression 時才解析，那時組件已經載好了。

Add-Type -AssemblyName System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$body = @'
$src = New-Object System.Drawing.Bitmap((Join-Path $dir 'icon-src.png'))
Write-Output ("source: {0}x{1}" -f $src.Width, $src.Height)

# 補邊色：取邊框八個點平均。只取一個角落像素會偏掉（來源多半有暈影或 JPEG 雜訊），
# maskable 版就會出現一圈看得見的接縫。
$m  = 8
$x1 = [int]$src.Width  - 1 - $m
$y1 = [int]$src.Height - 1 - $m
$cx = [int]($src.Width / 2)
$cy = [int]($src.Height / 2)
$samples = @(
    $src.GetPixel($m,  $m),  $src.GetPixel($x1, $m),
    $src.GetPixel($m,  $y1), $src.GetPixel($x1, $y1),
    $src.GetPixel($cx, $m),  $src.GetPixel($cx, $y1),
    $src.GetPixel($m,  $cy), $src.GetPixel($x1, $cy)
)
$r = 0; $gg = 0; $bb = 0
foreach ($c in $samples) { $r += $c.R; $gg += $c.G; $bb += $c.B }
$n = $samples.Count
$pad = [System.Drawing.Color]::FromArgb([int]($r/$n), [int]($gg/$n), [int]($bb/$n))
Write-Output ("pad colour: #{0:X2}{1:X2}{2:X2} (avg of {3} edge samples)" -f $pad.R, $pad.G, $pad.B, $n)

function Save-Icon {
    param([int]$Size, [string]$Name, [double]$Inset = 1.0)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = 'HighQualityBicubic'
    $g.PixelOffsetMode    = 'HighQuality'
    $g.SmoothingMode      = 'HighQuality'
    $g.CompositingQuality = 'HighQuality'

    # maskable：Android 會把圖示裁成圓角／圓形遮罩，貼邊的元素（愛心、葉子）會被切掉。
    # 縮到 Inset 比例置中、外圈補圖片自己的底色，裁切後主體才完整。
    # 用 Clear 不用 SolidBrush：少一個要 Dispose 的物件，也避開 New-Object 傳 struct 的坑。
    # 新的 Bitmap 預設全透明，不填的話 maskable 版四周會是透明的。
    $g.Clear($script:pad)

    $inner = [int][Math]::Round($Size * $Inset)
    $off   = [int][Math]::Round(($Size - $inner) / 2.0)
    $g.DrawImage($script:src, $off, $off, $inner, $inner)
    $g.Dispose()

    $path = Join-Path $script:dir $Name
    $bmp.Save($path)          # 副檔名 .png → 存成 PNG
    $bmp.Dispose()
    Write-Output ("  {0}  {1}x{1}  {2} bytes" -f $Name, $Size, (Get-Item $path).Length)
}

Save-Icon -Size 192 -Name 'icon-192.png'
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 180 -Name 'apple-touch-icon.png'
Save-Icon -Size 512 -Name 'icon-maskable-512.png' -Inset 0.78

$src.Dispose()
Write-Output 'done'
'@

Invoke-Expression $body

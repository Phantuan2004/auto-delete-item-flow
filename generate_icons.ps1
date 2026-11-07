Add-Type -AssemblyName System.Drawing
$sizes = @(16, 48, 128)
$iconDir = Join-Path $PSScriptRoot "chrome-extension\icons"
if (-not (Test-Path $iconDir)) {
    New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    
    # Red circle background
    $brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(234, 67, 53))
    $g.FillEllipse($brushBg, 1, 1, ($s - 2), ($s - 2))
    
    # White letter 'V'
    $brushFg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $fontSize = [Math]::Max(7.0, ($s * 0.45))
    $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    $rect = New-Object System.Drawing.RectangleF 0, 0, $s, $s
    $g.DrawString('V', $font, $brushFg, $rect, $sf)
    
    $outPath = Join-Path $iconDir "icon$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $font.Dispose()
    $brushFg.Dispose()
    $brushBg.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

Write-Output "Icons generated successfully in $iconDir"


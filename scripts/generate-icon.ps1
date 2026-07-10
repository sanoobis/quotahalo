Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectanglePath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

$bounds = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$backgroundPath = New-RoundedRectanglePath 3 3 250 250 61
$backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bounds,
    [System.Drawing.Color]::FromArgb(255, 28, 36, 47),
    [System.Drawing.Color]::FromArgb(255, 8, 11, 16),
    48
)
$graphics.FillPath($backgroundBrush, $backgroundPath)

$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(22, 255, 255, 255), 8)
$graphics.DrawPath($borderPen, (New-RoundedRectanglePath 7 7 242 242 57))

$glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 139, 255, 176))
$graphics.FillEllipse($glowBrush, 34, 34, 188, 188)

$mint = [System.Drawing.Color]::FromArgb(255, 139, 255, 176)
$outerPen = New-Object System.Drawing.Pen($mint, 12)
$innerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(170, 139, 255, 176), 9)
$sweepPen = New-Object System.Drawing.Pen($mint, 13)
$sweepPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$sweepPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$graphics.DrawEllipse($outerPen, 41, 41, 174, 174)
$graphics.DrawEllipse($innerPen, 80, 80, 96, 96)
$graphics.DrawLine($sweepPen, 128, 128, 194, 62)
$centerBrush = New-Object System.Drawing.SolidBrush($mint)
$graphics.FillEllipse($centerBrush, 113, 113, 30, 30)

$target = Join-Path $PSScriptRoot '..\assets\icon.png'
$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

$centerBrush.Dispose()
$sweepPen.Dispose()
$innerPen.Dispose()
$outerPen.Dispose()
$glowBrush.Dispose()
$borderPen.Dispose()
$backgroundBrush.Dispose()
$backgroundPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Generated $target"

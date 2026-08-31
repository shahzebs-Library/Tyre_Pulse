param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceDirectory = Join-Path $ProjectRoot 'assets\vehicle_multiview'
$outputDirectory = Join-Path $ProjectRoot 'assets\vehicle_multiview_views'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function Rect([int]$x, [int]$y, [int]$width, [int]$height) {
  return [System.Drawing.Rectangle]::new($x, $y, $width, $height)
}

function ThreeColumnBoard {
  return @{
    front = (Rect 1 1 416 625)
    rear  = (Rect 419 1 416 625)
    top   = (Rect 837 1 416 625)
    left  = (Rect 1 628 416 625)
    right = (Rect 419 628 416 625)
  }
}

# These rectangles were inspected against every 1254x1254 source board.
# They deliberately describe each board rather than assuming one shared grid:
# some lower rows use three columns, others use two, and several generated
# boards are free-form collages whose top/side views occupy unequal bounds.
$layouts = @{
  'cat_skid_loader_five_view_v1' = (ThreeColumnBoard)
  'generic_double_cab_five_view_v1' = (ThreeColumnBoard)
  'industrial_chiller_five_view_v1' = (ThreeColumnBoard)
  'placing_boom_five_view_v1' = (ThreeColumnBoard)
  'sany_concrete_pump_5axle_five_view_v1' = (ThreeColumnBoard)
  'sany_towable_pump_five_view_v1' = (ThreeColumnBoard)
  'sany_wheel_loader_five_view_v1' = (ThreeColumnBoard)
  'toyota_hiace_five_view_v1' = (ThreeColumnBoard)
  'white_concrete_pump_4axle_five_view_v1' = (ThreeColumnBoard)

  'transit_mixer_3axle_five_view_v1' = @{
    front = (Rect 1 1 416 625); rear = (Rect 419 1 416 625)
    top = (Rect 837 1 416 625); left = (Rect 1 628 625 625)
    right = (Rect 628 628 625 625)
  }
  'ashok_leyland_bus_five_view_v1' = @{
    front = (Rect 0 0 455 610); rear = (Rect 455 0 450 610)
    top = (Rect 905 0 349 930); left = (Rect 0 600 905 330)
    right = (Rect 0 930 905 324)
  }
  'generic_staff_bus_five_view_v1' = @{
    front = (Rect 0 0 495 627); rear = (Rect 495 0 417 627)
    top = (Rect 912 0 342 627); left = (Rect 0 627 720 343)
    right = (Rect 200 970 714 284)
  }
  'tata_staff_bus_five_view_v1' = @{
    front = (Rect 0 0 460 600); rear = (Rect 460 0 440 600)
    top = (Rect 900 0 354 1254); left = (Rect 0 590 900 350)
    right = (Rect 0 930 900 324)
  }
  'mitsubishi_double_cab_five_view_v1' = @{
    front = (Rect 0 0 420 627); rear = (Rect 420 0 440 627)
    top = (Rect 880 0 374 850); left = (Rect 0 650 650 330)
    right = (Rect 50 980 650 274)
  }
  'tata_xenon_double_cab_five_view_v1' = @{
    front = (Rect 0 0 430 620); rear = (Rect 430 0 430 620)
    top = (Rect 860 0 394 800); left = (Rect 0 780 620 360)
    right = (Rect 630 780 624 360)
  }
  'line_pump_4axle_five_view_v1' = @{
    front = (Rect 0 0 420 600); rear = (Rect 420 0 420 600)
    top = (Rect 840 0 414 730); left = (Rect 0 560 840 370)
    right = (Rect 420 900 834 354)
  }
  'sany_stationary_pump_five_view_v1' = @{
    front = (Rect 0 0 420 620); rear = (Rect 420 0 420 620)
    top = (Rect 840 0 414 620); left = (Rect 0 650 550 400)
    right = (Rect 580 650 550 400)
  }
  'sany_generator_five_view_v1' = @{
    front = (Rect 0 0 490 627); rear = (Rect 520 0 300 627)
    top = (Rect 830 0 424 627); left = (Rect 0 627 470 473)
    right = (Rect 470 627 470 473)
  }
  'sany_batching_plant_five_view_v1' = @{
    front = (Rect 0 0 430 600); rear = (Rect 430 0 420 600)
    top = (Rect 850 0 404 620); left = (Rect 0 600 560 550)
    right = (Rect 560 600 540 550)
  }
  'snowkey_chiller_five_view_v1' = @{
    front = (Rect 627 0 627 444); rear = (Rect 627 750 627 504)
    top = (Rect 627 444 627 306); left = (Rect 0 0 627 599)
    right = (Rect 0 599 627 655)
  }
}

if ($layouts.Count -ne 20) {
  throw "Expected 20 board layouts, found $($layouts.Count)."
}

foreach ($stem in ($layouts.Keys | Sort-Object)) {
  $sourcePath = Join-Path $sourceDirectory "$stem.png"
  if (-not [System.IO.File]::Exists($sourcePath)) {
    throw "Missing source board: $sourcePath"
  }
  $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
  try {
    foreach ($view in @('front', 'rear', 'top', 'left', 'right')) {
      $crop = $layouts[$stem][$view]
      if ($crop.Right -gt $source.Width -or $crop.Bottom -gt $source.Height) {
        throw "$stem/$view crop exceeds the source board."
      }

      $target = [System.Drawing.Bitmap]::new(768, 768)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($target)
        try {
          $graphics.Clear([System.Drawing.Color]::White)
          $graphics.CompositingQuality =
            [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode =
            [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.PixelOffsetMode =
            [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

          $available = 736.0
          $scale = [Math]::Min($available / $crop.Width, $available / $crop.Height)
          $width = [int][Math]::Round($crop.Width * $scale)
          $height = [int][Math]::Round($crop.Height * $scale)
          $destination = [System.Drawing.Rectangle]::new(
            [int][Math]::Round((768 - $width) / 2),
            [int][Math]::Round((768 - $height) / 2),
            $width,
            $height
          )
          $graphics.DrawImage(
            $source,
            $destination,
            $crop,
            [System.Drawing.GraphicsUnit]::Pixel
          )
        } finally {
          $graphics.Dispose()
        }

        $outputPath = Join-Path $outputDirectory "${stem}_${view}.png"
        $target.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $target.Dispose()
      }
    }
  } finally {
    $source.Dispose()
  }
}

Write-Output "Exported $($layouts.Count * 5) isolated 768x768 views."

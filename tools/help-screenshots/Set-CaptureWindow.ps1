param(
    [int]$Width = 1400,
    [Nullable[int]]$Height = $null
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Width -lt 1080 -or ($null -ne $Height -and $Height -lt 640)) {
    throw "DB Sage requires a window of at least 1080 x 640."
}

if (-not ("DbsageCaptureWindow" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DbsageCaptureWindow
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(
        uint action,
        uint parameter,
        out Rect value,
        uint update
    );

    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        out Rect value,
        int valueSize
    );

    public static IntPtr FindLargestVisibleWindow(int processId)
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumWindows((hwnd, state) =>
        {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != processId || !IsWindowVisible(hwnd)) return true;

            Rect rect;
            if (!GetWindowRect(hwnd, out rect)) return true;
            long width = Math.Max(0, rect.Right - rect.Left);
            long height = Math.Max(0, rect.Bottom - rect.Top);
            long area = width * height;
            if (area > bestArea)
            {
                best = hwnd;
                bestArea = area;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
"@
}

$PerMonitorAwareV2 = [IntPtr](-4)
$previousDpiContext = [DbsageCaptureWindow]::SetThreadDpiAwarenessContext($PerMonitorAwareV2)

try {
$candidate = $null
$candidateArea = 0L
foreach ($process in Get-Process -Name "dbsage" -ErrorAction SilentlyContinue) {
    $handle = [DbsageCaptureWindow]::FindLargestVisibleWindow($process.Id)
    if ($handle -eq [IntPtr]::Zero) { continue }

    $rect = New-Object DbsageCaptureWindow+Rect
    if (-not [DbsageCaptureWindow]::GetWindowRect($handle, [ref]$rect)) { continue }
    $area = [int64]($rect.Right - $rect.Left) * [int64]($rect.Bottom - $rect.Top)
    if ($area -gt $candidateArea) {
        $candidate = $handle
        $candidateArea = $area
    }
}

if ($null -eq $candidate) {
    throw "No visible DB Sage window was found. Start DB Sage and try again."
}

$workArea = New-Object DbsageCaptureWindow+Rect
if (-not [DbsageCaptureWindow]::SystemParametersInfo(0x0030, 0, [ref]$workArea, 0)) {
    throw "Windows did not report the monitor work area."
}

$availableWidth = $workArea.Right - $workArea.Left
$availableHeight = $workArea.Bottom - $workArea.Top
$targetWidth = [Math]::Min($Width, $availableWidth)

# GetWindowRect includes the invisible resize border on modern Windows, while
# active-window capture tools use DWM's visible extended-frame bounds. Account
# for those insets so the saved image itself has the requested dimensions.
$outerRect = New-Object DbsageCaptureWindow+Rect
$visibleRect = New-Object DbsageCaptureWindow+Rect
if (-not [DbsageCaptureWindow]::GetWindowRect($candidate, [ref]$outerRect)) {
    throw "Windows could not read the DB Sage window dimensions."
}
$DwmExtendedFrameBounds = 9
$rectSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DbsageCaptureWindow+Rect])
$dwmResult = [DbsageCaptureWindow]::DwmGetWindowAttribute(
    $candidate,
    $DwmExtendedFrameBounds,
    [ref]$visibleRect,
    $rectSize
)
if ($dwmResult -ne 0) {
    throw "Windows could not read DB Sage's visible frame bounds (DWM error $dwmResult)."
}

$currentVisibleHeight = $visibleRect.Bottom - $visibleRect.Top
$requestedHeight = if ($null -eq $Height) { $currentVisibleHeight } else { [int]$Height }
$targetHeight = [Math]::Min($requestedHeight, $availableHeight)

$leftInset = $visibleRect.Left - $outerRect.Left
$topInset = $visibleRect.Top - $outerRect.Top
$rightInset = $outerRect.Right - $visibleRect.Right
$bottomInset = $outerRect.Bottom - $visibleRect.Bottom
$outerTargetWidth = $targetWidth + $leftInset + $rightInset
$outerTargetHeight = $targetHeight + $topInset + $bottomInset
$visibleX = $workArea.Left + [Math]::Floor(($availableWidth - $targetWidth) / 2)
$visibleY = $workArea.Top + [Math]::Floor(($availableHeight - $targetHeight) / 2)
$x = $visibleX - $leftInset
$y = $visibleY - $topInset

$NoZOrder = 0x0004
$ShowWindow = 0x0040
$changed = [DbsageCaptureWindow]::SetWindowPos(
    $candidate,
    [IntPtr]::Zero,
    $x,
    $y,
    $outerTargetWidth,
    $outerTargetHeight,
    $NoZOrder -bor $ShowWindow
)

if (-not $changed) {
    throw "Windows could not resize the DB Sage window."
}

$actualRect = New-Object DbsageCaptureWindow+Rect
$dwmResult = [DbsageCaptureWindow]::DwmGetWindowAttribute(
    $candidate,
    $DwmExtendedFrameBounds,
    [ref]$actualRect,
    $rectSize
)
if ($dwmResult -ne 0) {
    throw "Windows resized DB Sage, but its visible dimensions could not be verified (DWM error $dwmResult)."
}
$actualWidth = $actualRect.Right - $actualRect.Left
$actualHeight = $actualRect.Bottom - $actualRect.Top
if ($actualWidth -ne $targetWidth -or $actualHeight -ne $targetHeight) {
    throw "DB Sage's visible frame was resized to $actualWidth x $actualHeight instead of $targetWidth x $targetHeight."
}

Write-Host "DB Sage's visible capture frame is centered and verified at $actualWidth x $actualHeight physical pixels."
Write-Host "Leave this window size and the sidebar splitter unchanged while capturing."
} finally {
    if ($previousDpiContext -ne [IntPtr]::Zero) {
        [void][DbsageCaptureWindow]::SetThreadDpiAwarenessContext($previousDpiContext)
    }
}

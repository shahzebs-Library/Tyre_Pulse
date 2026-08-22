function Refactor-File {
    param([string]$FilePath)
    
    $content = Get-Content $FilePath -Raw -Encoding UTF8
    
    if ($content -notmatch 'PullToRefresh') {
        return
    }
    
    # 1. Fix Imports
    $content = $content -replace 'import androidx\.compose\.material3\.pulltorefresh\.PullToRefreshContainer', 'import androidx.compose.material3.pulltorefresh.PullToRefreshBox'
    $content = $content -replace 'import androidx\.compose\.material3\.pulltorefresh\.rememberPullToRefreshState\r?\n?', ''
    $content = $content -replace 'import androidx\.compose\.ui\.input\.nestedscroll\.nestedScroll\r?\n?', ''
    
    # Add runtime imports if needed
    if ($content -notmatch 'import androidx\.compose\.runtime\.getValue') {
        $content = $content -replace 'import androidx\.compose\.runtime\.Composable', "import androidx.compose.runtime.Composable`nimport androidx.compose.runtime.getValue`nimport androidx.compose.runtime.setValue`nimport androidx.compose.runtime.mutableStateOf"
    }

    # 2. Replace State Declaration
    $content = $content -replace 'val pullToRefreshState\s*=\s*rememberPullToRefreshState\(\)', 'var isRefreshing by remember { mutableStateOf(false) }'

    # 3. Replace Logic References
    $content = $content -replace 'pullToRefreshState\.isRefreshing', 'isRefreshing'
    $content = $content -replace 'pullToRefreshState\.endRefresh\(\)', 'isRefreshing = false'
    
    # 4. Replace Box with PullToRefreshBox
    $patternBox = '(?s)Box\s*\(\s*modifier\s*=\s*Modifier(.*?)\.nestedScroll\(pullToRefreshState\.nestedScrollConnection\)(.*?)\)\s*\{'
    $content = [regex]::Replace($content, $patternBox, {
        param($match)
        $modBefore = $match.Groups[1].Value
        $modAfter = $match.Groups[2].Value
        return "PullToRefreshBox(`n            isRefreshing = isRefreshing,`n            onRefresh = { isRefreshing = true },`n            modifier = Modifier$modBefore$modAfter`n        ) {"
    })
    
    # 5. Remove PullToRefreshContainer element
    $patternPtr = '(?s)PullToRefreshContainer\s*\(\s*state\s*=\s*pullToRefreshState.*?\n\s*\)'
    $content = $content -replace $patternPtr, ''

    [IO.File]::WriteAllText($FilePath, $content, [System.Text.Encoding]::UTF8)
}

Get-ChildItem -Path "app\src\main\java" -Recurse -Filter "*.kt" | ForEach-Object {
    Refactor-File -FilePath $_.FullName
}

function Ensure-Imports {
    param([string]$FilePath)
    $content = Get-Content $FilePath -Raw -Encoding UTF8
    
    if ($content -match 'var isRefreshing by remember') {
        $imports = @(
            "import androidx.compose.runtime.getValue",
            "import androidx.compose.runtime.setValue",
            "import androidx.compose.runtime.mutableStateOf",
            "import androidx.compose.runtime.remember"
        )
        
        $modified = $false
        foreach ($imp in $imports) {
            if ($content -notmatch [regex]::Escape($imp)) {
                # Insert after package declaration
                $content = $content -replace '(?m)^(package\s+.*?)$', "`$1`n$imp"
                $modified = $true
            }
        }
        
        if ($modified) {
            [IO.File]::WriteAllText($FilePath, $content, [System.Text.Encoding]::UTF8)
        }
    }
}

Get-ChildItem -Path "app\src\main\java" -Recurse -Filter "*.kt" | ForEach-Object {
    Ensure-Imports -FilePath $_.FullName
}

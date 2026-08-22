import os
import re

def refactor_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'PullToRefresh' not in content:
        return

    # Replace imports
    content = content.replace(
        'import androidx.compose.material3.pulltorefresh.PullToRefreshContainer',
        'import androidx.compose.material3.pulltorefresh.PullToRefreshBox'
    )
    content = content.replace(
        'import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState',
        'import androidx.compose.material3.pulltorefresh.PullToRefreshBox'
    )
    content = content.replace(
        'import androidx.compose.ui.input.nestedscroll.nestedScroll\n',
        ''
    )

    # Ensure necessary compose runtime imports
    if 'import androidx.compose.runtime.getValue' not in content:
        content = content.replace('import androidx.compose.runtime.Composable', 'import androidx.compose.runtime.Composable\nimport androidx.compose.runtime.getValue\nimport androidx.compose.runtime.setValue\nimport androidx.compose.runtime.mutableStateOf')

    # Replace state initialization
    content = re.sub(
        r'val pullToRefreshState\s*=\s*rememberPullToRefreshState\(\)',
        r'var isRefreshing by remember { mutableStateOf(false) }',
        content
    )

    # Replace logic
    content = content.replace('pullToRefreshState.isRefreshing', 'isRefreshing')
    content = content.replace('pullToRefreshState.endRefresh()', 'isRefreshing = false')

    # Replace Box with PullToRefreshBox
    box_pattern = r'Box\s*\(\s*modifier\s*=\s*Modifier([^)]*?)\.nestedScroll\(pullToRefreshState\.nestedScrollConnection\)([^)]*?)\)\s*\{'
    
    def box_replacement(match):
        mod_before = match.group(1)
        mod_after = match.group(2)
        return f'PullToRefreshBox(\n            isRefreshing = isRefreshing,\n            onRefresh = {{ isRefreshing = true }},\n            modifier = Modifier{mod_before}{mod_after}\n        ) {{'

    content = re.sub(box_pattern, box_replacement, content)

    # Remove the PullToRefreshContainer block
    ptr_container_pattern = r'PullToRefreshContainer\s*\(\s*state\s*=\s*pullToRefreshState[^)]*\)'
    content = re.sub(ptr_container_pattern, '', content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for root, dirs, files in os.walk('app/src/main/java'):
    for file in files:
        if file.endswith('.kt'):
            refactor_file(os.path.join(root, file))

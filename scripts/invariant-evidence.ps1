$ErrorActionPreference = "Stop"

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "hash mismatch: raw file is missing: $Path"
    }
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Read-ForgeInvariantOutput([string]$Stdout) {
    $countMatch = [regex]::Match(
        $Stdout,
        "invariant_[^\r\n]*\(runs:\s*([\d,]+),\s*calls:\s*([\d,]+),\s*reverts:\s*([\d,]+)\)"
    )
    if (-not $countMatch.Success) {
        throw "Could not parse invariant run/call/revert counts from raw Forge output."
    }

    $selectorCallCounts = [ordered]@{}
    $selectorMatches = [regex]::Matches(
        $Stdout,
        "(?m)^\|\s*LokHandler\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*$"
    )
    foreach ($match in $selectorMatches) {
        $selector = $match.Groups[1].Value
        if ($selectorCallCounts.Contains($selector)) {
            throw "Duplicate selector row '$selector' in raw Forge output."
        }
        $selectorCallCounts[$selector] = [int64]($match.Groups[2].Value.Replace(",", ""))
    }

    $settleDrawCallCount = [int64]0
    if ($selectorCallCounts.Contains("settleDraw")) {
        $settleDrawCallCount = [int64]$selectorCallCounts["settleDraw"]
    }

    return [pscustomobject]@{
        sequences = [int64]($countMatch.Groups[1].Value.Replace(",", ""))
        calls = [int64]($countMatch.Groups[2].Value.Replace(",", ""))
        reverts = [int64]($countMatch.Groups[3].Value.Replace(",", ""))
        selectorCallCounts = [pscustomobject]$selectorCallCounts
        settleDrawCallCount = $settleDrawCallCount
    }
}

function Add-SelectorCounts([hashtable]$Target, [psobject]$Source) {
    foreach ($property in $Source.PSObject.Properties) {
        if (-not $Target.ContainsKey($property.Name)) {
            $Target[$property.Name] = [int64]0
        }
        $Target[$property.Name] += [int64]$property.Value
    }
}

function Get-RepositoryProvenance([string]$ProjectRoot) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
        throw "Invariant campaigns require a Git repository."
    }
    $gitCommit = (& git -C $ProjectRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $gitCommit -notmatch "^[0-9a-f]{40}$") {
        throw "Could not capture the exact code commit."
    }
    $sourceStatusBeforeRun = ((& git -C $ProjectRoot status --porcelain=v1) -join "`n").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect Git source status." }
    if ($sourceStatusBeforeRun.Length -ne 0) {
        throw "dirty-source campaign rejected: commit or restore source/evidence changes before running."
    }
    return [pscustomobject]@{
        gitCommit = $gitCommit
        sourceStatusBeforeRun = $sourceStatusBeforeRun
    }
}

function New-DeterministicInvariantSeed([string]$Campaign, [int]$Shard) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("lok-task10:${Campaign}:${Shard}")
        $hash = $sha.ComputeHash($bytes)
        return "0x" + (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
    }
    finally {
        $sha.Dispose()
    }
}

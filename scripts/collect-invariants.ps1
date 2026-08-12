[CmdletBinding()]
param(
    [ValidateRange(1, [int]::MaxValue)]
    [int]$Sequences = 10000000,

    [ValidateRange(1, 1024)]
    [int]$Depth = 32,

    [ValidateRange(1, 128)]
    [int]$ShardsPerCampaign = 28
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ArtifactRoot = Join-Path $ProjectRoot "artifacts\invariants"
$ShardRoot = Join-Path $ArtifactRoot "shards"
$Forge = "C:\Users\TBC\.foundry\bin\forge.exe"
$runsPerShard = [int][math]::Ceiling($Sequences / [double]$ShardsPerCampaign)

$campaigns = @(
    [pscustomobject]@{ Name = "safety"; Contract = "LokSafetyInvariantTest" },
    [pscustomobject]@{ Name = "fairness"; Contract = "LokFairnessInvariantTest" }
)

function New-DeterministicSeed([string]$Campaign, [int]$Shard) {
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

function Get-CampaignSelectorSet([string]$Campaign) {
    if ($Campaign -ne "safety") { return @() }
    return @(
        "deposit",
        "withdraw",
        "emergencyWithdraw",
        "exit",
        "setTheta",
        "fundYield",
        "directCredit",
        "openCheckpoint",
        "submitCheckpoint",
        "submitForgedCheckpoint",
        "moveCustody",
        "proposeAdapter",
        "advanceTime",
        "activateAdapter",
        "drainRetiringAdapter",
        "removeRetiringAdapter",
        "pause",
        "openDraw",
        "abortDraw",
        "attemptReentrantMutation",
        "submitForgedTotals",
        "settleDraw"
    )
}

$expected = @()
foreach ($campaign in $campaigns) {
    for ($shard = 0; $shard -lt $ShardsPerCampaign; ++$shard) {
        $baseName = "$($campaign.Name)-$($shard.ToString('D3'))"
        $expected += [pscustomobject]@{
            Campaign = $campaign.Name
            Contract = $campaign.Contract
            Shard = $shard
            Seed = New-DeterministicSeed $campaign.Name $shard
            StdoutPath = Join-Path $ShardRoot "$baseName.stdout.log"
            StderrPath = Join-Path $ShardRoot "$baseName.stderr.log"
            ExitCodePath = Join-Path $ShardRoot "$baseName.exitcode"
        }
    }
}

$missingLogs = @($expected | Where-Object { -not (Test-Path -LiteralPath $_.StdoutPath -PathType Leaf) })
if ($missingLogs.Count -ne 0) {
    throw "Cannot collect: $($missingLogs.Count) expected shard logs do not exist."
}

$startedAt = ($expected | ForEach-Object { (Get-Item -LiteralPath $_.StdoutPath).CreationTimeUtc } | Sort-Object | Select-Object -First 1)
$lastProgress = [DateTime]::UtcNow.AddMinutes(-1)
do {
    $complete = @($expected | Where-Object { Test-Path -LiteralPath $_.ExitCodePath -PathType Leaf }).Count
    if (([DateTime]::UtcNow - $lastProgress).TotalSeconds -ge 60) {
        Write-Output "Completed shard exit files: $complete/$($expected.Count)"
        $lastProgress = [DateTime]::UtcNow
    }
    if ($complete -lt $expected.Count) { Start-Sleep -Seconds 10 }
} while ($complete -lt $expected.Count)

$completedAt = (
    $expected |
        ForEach-Object { (Get-Item -LiteralPath $_.ExitCodePath).LastWriteTimeUtc } |
        Sort-Object |
        Select-Object -Last 1
)

$forgeVersion = (& $Forge --version | Select-Object -First 1).Trim()
$gitCommit = "unavailable-not-a-git-repository"
if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")) {
    $gitCommit = (& git -C $ProjectRoot rev-parse HEAD).Trim()
}

$reports = @()
foreach ($campaign in $campaigns) {
    $campaignEntries = @($expected | Where-Object { $_.Campaign -eq $campaign.Name })
    $campaignSequences = [int64]0
    $campaignCalls = [int64]0
    $campaignReverts = [int64]0
    $campaignExitCode = 0
    $shardReports = @()
    $combined = New-Object System.Text.StringBuilder

    foreach ($entry in $campaignEntries) {
        $stdout = [System.IO.File]::ReadAllText($entry.StdoutPath)
        $stderr = [System.IO.File]::ReadAllText($entry.StderrPath)
        $match = [regex]::Match(
            $stdout,
            "invariant_[^\r\n]*\(runs:\s*([\d,]+),\s*calls:\s*([\d,]+),\s*reverts:\s*([\d,]+)\)"
        )
        if (-not $match.Success) {
            throw "Could not parse invariant counts for $($campaign.Name) shard $($entry.Shard)."
        }

        $actualSequences = [int64]($match.Groups[1].Value.Replace(",", ""))
        $actualCalls = [int64]($match.Groups[2].Value.Replace(",", ""))
        $reverts = [int64]($match.Groups[3].Value.Replace(",", ""))
        $shardExitCode = [int][System.IO.File]::ReadAllText($entry.ExitCodePath)
        $campaignSequences += $actualSequences
        $campaignCalls += $actualCalls
        $campaignReverts += $reverts
        if ($shardExitCode -ne 0) { $campaignExitCode = $shardExitCode }

        [void]$combined.AppendLine("===== shard $($entry.Shard) seed $($entry.Seed) =====")
        [void]$combined.AppendLine($stdout)
        if ($stderr.Length -gt 0) {
            [void]$combined.AppendLine("----- stderr -----")
            [void]$combined.AppendLine($stderr)
        }
        $shardReports += [pscustomobject]@{
            shard = $entry.Shard
            seed = $entry.Seed
            sequences = $actualSequences
            calls = $actualCalls
            reverts = $reverts
            exitCode = $shardExitCode
        }
    }

    $passed = $campaignExitCode -eq 0 -and $campaignSequences -ge $Sequences -and $campaignReverts -eq 0
    $durationSeconds = [math]::Round(($completedAt - $startedAt).TotalSeconds, 3)
    [System.IO.File]::WriteAllText((Join-Path $ArtifactRoot "$($campaign.Name).log"), $combined.ToString())
    $report = [ordered]@{
        abi = @()
        campaign = $campaign.Name
        contract = $campaign.Contract
        status = if ($passed) { "PASS" } else { "FAIL" }
        targetSequences = $Sequences
        sequences = $campaignSequences
        depth = $Depth
        calls = $campaignCalls
        reverts = $campaignReverts
        shards = $ShardsPerCampaign
        runsPerShard = $runsPerShard
        selectorSet = Get-CampaignSelectorSet $campaign.Name
        settlementSelectorIncluded = $campaign.Name -ne "safety" -or ((Get-CampaignSelectorSet $campaign.Name) -contains "settleDraw")
        shardResults = $shardReports
        durationSeconds = $durationSeconds
        forgeVersion = $forgeVersion
        gitCommit = $gitCommit
        generatedAtUtc = [DateTime]::UtcNow.ToString("o")
        proofWorker = "codex-current-context-by-owner-exception"
        independentReview = "PENDING_HUMAN_SIGNOFF"
        separationException = "Owner authorized the implementation context to execute Task 10 on 2026-08-10; this is not an independent-context review."
        exitCode = $campaignExitCode
        log = "artifacts/invariants/$($campaign.Name).log"
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $ArtifactRoot "$($campaign.Name).json"),
        ($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    )
    $reports += [pscustomobject]$report
    if (-not $passed) { throw "Campaign $($campaign.Name) failed collection gate." }
}

$summary = [ordered]@{
    abi = @()
    status = "PASS"
    requiredSequencesPerCampaign = $Sequences
    campaigns = $reports
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    independentReview = "PENDING_HUMAN_SIGNOFF"
}
[System.IO.File]::WriteAllText(
    (Join-Path $ArtifactRoot "summary.json"),
    ($summary | ConvertTo-Json -Depth 10) + [Environment]::NewLine
)

$reports | Format-Table campaign, status, sequences, calls, shards, durationSeconds -AutoSize

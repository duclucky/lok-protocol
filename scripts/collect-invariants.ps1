[CmdletBinding()]
param(
    [ValidateRange(1, [int]::MaxValue)] [int]$Sequences = 10000000,
    [ValidateRange(1, 1024)] [int]$Depth = 32,
    [ValidateRange(1, 128)] [int]$ShardsPerCampaign = 28
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "invariant-evidence.ps1")
$ArtifactRoot = Join-Path $ProjectRoot "artifacts\invariants"
$ShardRoot = Join-Path $ArtifactRoot "shards"

$campaigns = @(
    [pscustomobject]@{ Name = "safety"; Contract = "LokSafetyInvariantTest" },
    [pscustomobject]@{ Name = "fairness"; Contract = "LokFairnessInvariantTest" }
)
$currentCommit = (& git -C $ProjectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Cannot collect without a Git commit." }
$allCommits = [System.Collections.Generic.HashSet[string]]::new()
$codeCommit = $null
$allForgeVersions = [System.Collections.Generic.HashSet[string]]::new()
$allSolcVersions = [System.Collections.Generic.HashSet[string]]::new()
$allNodeVersions = [System.Collections.Generic.HashSet[string]]::new()
$reports = @()

foreach ($campaign in $campaigns) {
    $discovered = @(Get-ChildItem -LiteralPath $ShardRoot -Filter "$($campaign.Name)-*.shard.json" -File)
    if ($discovered.Count -gt $ShardsPerCampaign) {
        throw "duplicate shard evidence: expected $ShardsPerCampaign, found $($discovered.Count) for $($campaign.Name)."
    }
    if ($discovered.Count -lt $ShardsPerCampaign) {
        throw "missing shard evidence: expected $ShardsPerCampaign, found $($discovered.Count) for $($campaign.Name)."
    }

    $seenShards = [System.Collections.Generic.HashSet[int]]::new()
    $campaignSequences = [int64]0
    $campaignCalls = [int64]0
    $campaignReverts = [int64]0
    $campaignExitCode = 0
    $settleDrawCallCount = [int64]0
    $selectorCallCounts = @{}
    $validatedShards = @()
    $combined = New-Object System.Text.StringBuilder
    $startedAtUtc = $null
    $endedAtUtc = $null

    for ($shard = 0; $shard -lt $ShardsPerCampaign; ++$shard) {
        $baseName = "$($campaign.Name)-$($shard.ToString('D3'))"
        $artifactPath = Join-Path $ShardRoot "$baseName.shard.json"
        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            throw "missing shard $shard for campaign $($campaign.Name)."
        }
        $metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $artifactPath | ConvertFrom-Json
        if (-not $seenShards.Add([int]$metadata.shard)) {
            throw "duplicate shard $($metadata.shard) for campaign $($campaign.Name)."
        }
        if ([int]$metadata.shard -ne $shard -or [int]$metadata.shardCount -ne $ShardsPerCampaign) {
            throw "missing shard identity or wrong shard count in $artifactPath."
        }
        if ([int]$metadata.depth -ne $Depth) {
            throw "Shard depth mismatch in $artifactPath."
        }
        if ($metadata.campaign -ne $campaign.Name -or $metadata.contract -ne $campaign.Contract) {
            throw "Shard campaign/contract mismatch in $artifactPath."
        }
        if ($metadata.seed -ne (New-DeterministicInvariantSeed $campaign.Name $shard)) {
            throw "Shard seed mismatch in $artifactPath."
        }
        if ([string]$metadata.sourceStatusBeforeRun -ne "") {
            throw "dirty-source campaign rejected in $artifactPath."
        }
        if ([string]::IsNullOrWhiteSpace([string]$metadata.exactCommand) -or
            [string]::IsNullOrWhiteSpace([string]$metadata.forgeVersion) -or
            [string]::IsNullOrWhiteSpace([string]$metadata.solcVersion) -or
            [string]::IsNullOrWhiteSpace([string]$metadata.nodeVersion)) {
            throw "Shard command/tool provenance is incomplete in $artifactPath."
        }
        [void]$allCommits.Add([string]$metadata.gitCommit)
        [void]$allForgeVersions.Add([string]$metadata.forgeVersion)
        [void]$allSolcVersions.Add([string]$metadata.solcVersion)
        [void]$allNodeVersions.Add([string]$metadata.nodeVersion)
        if ($null -eq $codeCommit) { $codeCommit = [string]$metadata.gitCommit }
        if ([string]$metadata.gitCommit -ne $codeCommit) {
            throw "mixed code commits: shard=$($metadata.gitCommit), expected=$codeCommit."
        }

        $stdoutPath = Join-Path $ProjectRoot ([string]$metadata.rawStdout)
        $stderrPath = Join-Path $ProjectRoot ([string]$metadata.rawStderr)
        $launchPath = Join-Path $ProjectRoot ([string]$metadata.launchMetadata)
        if ((Get-FileSha256 $stdoutPath) -ne [string]$metadata.rawStdoutSha256 -or
            (Get-FileSha256 $stderrPath) -ne [string]$metadata.rawStderrSha256 -or
            (Get-FileSha256 $launchPath) -ne [string]$metadata.launchMetadataSha256) {
            throw "hash mismatch for raw shard evidence $baseName."
        }
        $launch = Get-Content -Raw -Encoding UTF8 -LiteralPath $launchPath | ConvertFrom-Json
        foreach ($field in @("campaign", "contract", "shard", "shardCount", "seed", "gitCommit", "exactCommand",
                "forgeVersion", "solcVersion", "nodeVersion", "startedAtUtc")) {
            if ([string]$launch.$field -ne [string]$metadata.$field) {
                throw "Launch metadata mismatch for $baseName/$field."
            }
        }
        if ([string]$launch.sourceStatusBeforeRun -ne "") {
            throw "dirty-source launch rejected in $launchPath."
        }
        $stdout = [System.IO.File]::ReadAllText($stdoutPath)
        $stderr = [System.IO.File]::ReadAllText($stderrPath)
        $parsed = Read-ForgeInvariantOutput $stdout
        if ($parsed.sequences -ne [int64]$metadata.sequences -or
            $parsed.calls -ne [int64]$metadata.calls -or
            $parsed.reverts -ne [int64]$metadata.reverts -or
            $parsed.settleDrawCallCount -ne [int64]$metadata.settleDrawCallCount) {
            throw "Parsed raw counts disagree with shard metadata for $baseName."
        }
        foreach ($property in $parsed.selectorCallCounts.PSObject.Properties) {
            if ([int64]$metadata.selectorCallCounts.($property.Name) -ne [int64]$property.Value) {
                throw "Parsed selector count mismatch for $baseName/$($property.Name)."
            }
        }
        if (@($metadata.selectorCallCounts.PSObject.Properties).Count -ne
            @($parsed.selectorCallCounts.PSObject.Properties).Count) {
            throw "Parsed selector set mismatch for $baseName."
        }

        $campaignSequences += $parsed.sequences
        $campaignCalls += $parsed.calls
        $campaignReverts += $parsed.reverts
        $settleDrawCallCount += $parsed.settleDrawCallCount
        Add-SelectorCounts $selectorCallCounts $parsed.selectorCallCounts
        if ([int]$metadata.exitCode -ne 0) { $campaignExitCode = [int]$metadata.exitCode }
        $validatedShards += $metadata
        $shardStart = [DateTime]::Parse([string]$metadata.startedAtUtc).ToUniversalTime()
        $shardEnd = [DateTime]::Parse([string]$metadata.endedAtUtc).ToUniversalTime()
        if ($null -eq $startedAtUtc -or $shardStart -lt $startedAtUtc) { $startedAtUtc = $shardStart }
        if ($null -eq $endedAtUtc -or $shardEnd -gt $endedAtUtc) { $endedAtUtc = $shardEnd }
        [void]$combined.AppendLine("===== shard $shard seed $($metadata.seed) =====")
        [void]$combined.AppendLine($stdout)
        if ($stderr.Length -gt 0) { [void]$combined.AppendLine($stderr) }
    }

    if ($seenShards.Count -ne $ShardsPerCampaign) { throw "missing shard after identity validation." }
    $settlementSelectorIncluded = $settleDrawCallCount -gt 0
    $passed = $campaignExitCode -eq 0 -and $campaignSequences -ge $Sequences -and `
        $campaignReverts -eq 0 -and $settlementSelectorIncluded
    if (-not $passed) {
        throw "Campaign $($campaign.Name) failed: sequences=$campaignSequences reverts=$campaignReverts settleDraw=$settleDrawCallCount exit=$campaignExitCode."
    }

    $rawLogPath = Join-Path $ArtifactRoot "$($campaign.Name).raw.txt"
    [System.IO.File]::WriteAllText($rawLogPath, $combined.ToString())
    $rawLogSha256 = Get-FileSha256 $rawLogPath
    $report = [ordered]@{
        abi = @(); schemaVersion = 2; campaign = $campaign.Name; contract = $campaign.Contract; status = "PASS"
        targetSequences = $Sequences; sequences = $campaignSequences; depth = $Depth; calls = $campaignCalls
        reverts = $campaignReverts; shards = $ShardsPerCampaign
        selectorCallCounts = [pscustomobject]$selectorCallCounts
        settleDrawCallCount = $settleDrawCallCount; settlementSelectorIncluded = $settlementSelectorIncluded
        shardResults = $validatedShards; gitCommit = $codeCommit; sourceStatusBeforeRun = ""
        exactCommand = ".\scripts\collect-invariants.ps1 -Sequences $Sequences -Depth $Depth -ShardsPerCampaign $ShardsPerCampaign"
        forgeVersion = $validatedShards[0].forgeVersion; solcVersion = $validatedShards[0].solcVersion
        nodeVersion = $validatedShards[0].nodeVersion
        startedAtUtc = $startedAtUtc.ToString("o"); endedAtUtc = $endedAtUtc.ToString("o")
        durationSeconds = [math]::Round(($endedAtUtc - $startedAtUtc).TotalSeconds, 3)
        rawLog = "artifacts/invariants/$($campaign.Name).raw.txt"; rawLogSha256 = $rawLogSha256
        proofWorker = "codex-current-context-by-owner-exception"
        independentReview = "PENDING_INDEPENDENT_AUDIT"; exitCode = $campaignExitCode
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $ArtifactRoot "$($campaign.Name).json"),
        ($report | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    )
    $reports += [pscustomobject]$report
}

if ($allCommits.Count -ne 1) { throw "mixed code commits across campaigns." }
& git -C $ProjectRoot merge-base --is-ancestor $codeCommit $currentCommit
if ($LASTEXITCODE -ne 0) {
    throw "Evidence code commit $codeCommit is not an ancestor of current commit $currentCommit."
}
if ($allForgeVersions.Count -ne 1 -or $allSolcVersions.Count -ne 1 -or $allNodeVersions.Count -ne 1) {
    throw "mixed tool versions across campaign shards."
}
$summary = [ordered]@{
    abi = @(); schemaVersion = 2; status = "PASS"; requiredSequencesPerCampaign = $Sequences
    gitCommit = $codeCommit; sourceStatusBeforeRun = ""; campaigns = $reports
    generatedAtUtc = [DateTime]::UtcNow.ToString("o"); independentReview = "PENDING_INDEPENDENT_AUDIT"
}
[System.IO.File]::WriteAllText(
    (Join-Path $ArtifactRoot "summary.json"),
    ($summary | ConvertTo-Json -Depth 14) + [Environment]::NewLine
)
$reports | Format-Table campaign, status, sequences, calls, settleDrawCallCount, shards, durationSeconds -AutoSize

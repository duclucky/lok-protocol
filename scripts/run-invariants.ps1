[CmdletBinding()]
param(
    [ValidateRange(1, [int]::MaxValue)]
    [int]$Sequences = 10000000,

    [ValidateRange(1, 1024)]
    [int]$Depth = 32,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$FuzzRuns = 256,

    [ValidateRange(1, 128)]
    [int]$ShardsPerCampaign = 1,

    [ValidateRange(1, 32)]
    [int]$ThreadsPerShard = 1,

    [Alias("Campaign")]
    [ValidateSet("all", "safety", "fairness")]
    [string]$CampaignName = "all"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ArtifactRoot = Join-Path $ProjectRoot "artifacts\invariants"
$ShardRoot = Join-Path $ArtifactRoot "shards"
$Forge = "C:\Users\TBC\.foundry\bin\forge.exe"
$ShardRunner = Join-Path $PSScriptRoot "run-invariant-shard.ps1"

if (-not (Test-Path -LiteralPath $Forge -PathType Leaf)) {
    throw "Forge executable not found at $Forge"
}

New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ShardRoot -Force | Out-Null

$forgeVersion = (& $Forge --version | Select-Object -First 1).Trim()
$gitCommit = "unavailable-not-a-git-repository"
if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")) {
    $gitCommit = (& git -C $ProjectRoot rev-parse HEAD).Trim()
}

$allCampaigns = @(
    [pscustomobject]@{ Name = "safety"; Contract = "LokSafetyInvariantTest" },
    [pscustomobject]@{ Name = "fairness"; Contract = "LokFairnessInvariantTest" }
)
$campaigns = if ($CampaignName -eq "all") {
    $allCampaigns
}
else {
    @($allCampaigns | Where-Object { $_.Name -eq $CampaignName })
}

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

$runsPerShard = [int][math]::Ceiling($Sequences / [double]$ShardsPerCampaign)
$previousRuns = $env:FOUNDRY_INVARIANT_RUNS
$previousDepth = $env:FOUNDRY_INVARIANT_DEPTH
$previousFuzzRuns = $env:FOUNDRY_FUZZ_RUNS
$processes = @()
$reports = @()
$startedAt = [DateTime]::UtcNow

try {
    $env:FOUNDRY_INVARIANT_RUNS = $runsPerShard.ToString()
    $env:FOUNDRY_INVARIANT_DEPTH = $Depth.ToString()
    $env:FOUNDRY_FUZZ_RUNS = $FuzzRuns.ToString()

    foreach ($campaign in $campaigns) {
        for ($shard = 0; $shard -lt $ShardsPerCampaign; ++$shard) {
            $seed = New-DeterministicSeed $campaign.Name $shard
            $baseName = "$($campaign.Name)-$($shard.ToString('D3'))"
            $stdoutPath = Join-Path $ShardRoot "$baseName.stdout.log"
            $stderrPath = Join-Path $ShardRoot "$baseName.stderr.log"
            $exitCodePath = Join-Path $ShardRoot "$baseName.exitcode"
            if (Test-Path -LiteralPath $exitCodePath) {
                [System.IO.File]::Delete($exitCodePath)
            }
            $arguments = @(
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", $ShardRunner,
                "-Forge", $Forge,
                "-ProjectRoot", $ProjectRoot,
                "-Contract", $campaign.Contract,
                "-Seed", $seed,
                "-Threads", $ThreadsPerShard.ToString(),
                "-ExitCodePath", $exitCodePath
            )
            $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $ProjectRoot `
                -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
            $processes += [pscustomobject]@{
                Campaign = $campaign.Name
                Contract = $campaign.Contract
                Shard = $shard
                Seed = $seed
                Process = $process
                StdoutPath = $stdoutPath
                StderrPath = $stderrPath
                ExitCodePath = $exitCodePath
                StartedAt = [DateTime]::UtcNow
            }
        }
    }

    Write-Output "Started $($processes.Count) Forge shards: $ShardsPerCampaign per campaign, $runsPerShard sequences per shard."
    foreach ($entry in $processes) {
        $entry.Process.WaitForExit()
    }

    foreach ($campaign in $campaigns) {
        $campaignEntries = @($processes | Where-Object { $_.Campaign -eq $campaign.Name })
        $campaignSequences = [int64]0
        $campaignCalls = [int64]0
        $campaignReverts = [int64]0
        $shardReports = @()
        $combined = New-Object System.Text.StringBuilder
        $campaignExitCode = 0

        foreach ($entry in $campaignEntries) {
            $stdout = [System.IO.File]::ReadAllText($entry.StdoutPath)
            $stderr = [System.IO.File]::ReadAllText($entry.StderrPath)
            [void]$combined.AppendLine("===== shard $($entry.Shard) seed $($entry.Seed) =====")
            [void]$combined.AppendLine($stdout)
            if ($stderr.Length -gt 0) {
                [void]$combined.AppendLine("----- stderr -----")
                [void]$combined.AppendLine($stderr)
            }

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
            if (-not (Test-Path -LiteralPath $entry.ExitCodePath -PathType Leaf)) {
                throw "Missing exit-code file for $($campaign.Name) shard $($entry.Shard)."
            }
            $shardExitCode = [int][System.IO.File]::ReadAllText($entry.ExitCodePath)
            $duration = ([DateTime]::UtcNow - $entry.StartedAt).TotalSeconds
            $campaignSequences += $actualSequences
            $campaignCalls += $actualCalls
            $campaignReverts += $reverts
            if ($shardExitCode -ne 0) { $campaignExitCode = $shardExitCode }
            $shardReports += [pscustomobject]@{
                shard = $entry.Shard
                seed = $entry.Seed
                sequences = $actualSequences
                calls = $actualCalls
                reverts = $reverts
                exitCode = $shardExitCode
                durationSeconds = [math]::Round($duration, 3)
            }
        }

        $logPath = Join-Path $ArtifactRoot "$($campaign.Name).log"
        [System.IO.File]::WriteAllText($logPath, $combined.ToString())
        $passed = $campaignExitCode -eq 0 -and $campaignSequences -ge $Sequences -and $campaignReverts -eq 0
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
            shardResults = $shardReports
            durationSeconds = [math]::Round(([DateTime]::UtcNow - $startedAt).TotalSeconds, 3)
            forgeVersion = $forgeVersion
            gitCommit = $gitCommit
            generatedAtUtc = [DateTime]::UtcNow.ToString("o")
            proofWorker = "codex-current-context-by-owner-exception"
            independentReview = "PENDING_HUMAN_SIGNOFF"
            separationException = "Owner authorized the implementation context to execute Task 10 on 2026-08-10; this is not an independent-context review."
            exitCode = $campaignExitCode
            log = "artifacts/invariants/$($campaign.Name).log"
        }
        $reportPath = Join-Path $ArtifactRoot "$($campaign.Name).json"
        [System.IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
        $reports += [pscustomobject]$report

        if (-not $passed) {
            throw "Campaign $($campaign.Name) failed or did not reach $Sequences sequences. See $reportPath"
        }
    }
}
finally {
    foreach ($entry in $processes) {
        if (-not $entry.Process.HasExited) {
            $entry.Process.Kill()
            $entry.Process.WaitForExit()
        }
        $entry.Process.Dispose()
    }
    $env:FOUNDRY_INVARIANT_RUNS = $previousRuns
    $env:FOUNDRY_INVARIANT_DEPTH = $previousDepth
    $env:FOUNDRY_FUZZ_RUNS = $previousFuzzRuns
}

$summaryReports = @()
foreach ($knownCampaign in $allCampaigns) {
    $fresh = @($reports | Where-Object { $_.campaign -eq $knownCampaign.Name })
    if ($fresh.Count -ne 0) {
        $summaryReports += $fresh[0]
        continue
    }

    $existingPath = Join-Path $ArtifactRoot "$($knownCampaign.Name).json"
    if (-not (Test-Path -LiteralPath $existingPath -PathType Leaf)) {
        throw "Cannot preserve omitted campaign '$($knownCampaign.Name)': $existingPath does not exist."
    }
    $existing = Get-Content -LiteralPath $existingPath -Raw | ConvertFrom-Json
    if ($existing.status -ne "PASS" -or [int64]$existing.sequences -lt $Sequences) {
        throw "Cannot preserve omitted campaign '$($knownCampaign.Name)': existing evidence does not meet the gate."
    }
    $summaryReports += $existing
}

$summary = [ordered]@{
    abi = @()
    status = "PASS"
    requiredSequencesPerCampaign = $Sequences
    campaigns = $summaryReports
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    independentReview = "PENDING_HUMAN_SIGNOFF"
}
[System.IO.File]::WriteAllText(
    (Join-Path $ArtifactRoot "summary.json"),
    ($summary | ConvertTo-Json -Depth 10) + [Environment]::NewLine
)

$reports | Format-Table campaign, status, sequences, calls, shards, durationSeconds -AutoSize

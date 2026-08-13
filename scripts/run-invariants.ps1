[CmdletBinding()]
param(
    [ValidateRange(1, [int]::MaxValue)] [int]$Sequences = 10000000,
    [ValidateRange(1, 1024)] [int]$Depth = 32,
    [ValidateRange(1, [int]::MaxValue)] [int]$FuzzRuns = 256,
    [ValidateRange(1, 128)] [int]$ShardsPerCampaign = 1,
    [ValidateRange(1, 32)] [int]$ThreadsPerShard = 1,
    [Alias("Campaign")]
    [ValidateSet("all", "safety", "fairness")] [string]$CampaignName = "all"
)

$ErrorActionPreference = "Stop"
if ($CampaignName -ne "all") {
    throw "Partial evidence campaigns are forbidden; use -Campaign all."
}
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "invariant-evidence.ps1")

$ArtifactRoot = Join-Path $ProjectRoot "artifacts\invariants"
$ShardRoot = Join-Path $ArtifactRoot "shards"
$Forge = "C:\Users\TBC\.foundry\bin\forge.exe"
$ShardRunner = Join-Path $PSScriptRoot "run-invariant-shard.ps1"
if (-not (Test-Path -LiteralPath $Forge -PathType Leaf)) { throw "Forge executable not found at $Forge" }

$provenance = Get-RepositoryProvenance $ProjectRoot
$gitCommit = $provenance.gitCommit
$sourceStatusBeforeRun = $provenance.sourceStatusBeforeRun
$forgeVersion = (& $Forge --version | Select-Object -First 1).Trim()
$forgeConfig = (& $Forge config --json | ConvertFrom-Json)
$solcVersion = [string]$forgeConfig.solc
$nodeVersion = (& node --version).Trim()
$topLevelExactCommand = ".\scripts\run-invariants.ps1 -Campaign $CampaignName -Sequences $Sequences -Depth $Depth -FuzzRuns $FuzzRuns -ShardsPerCampaign $ShardsPerCampaign -ThreadsPerShard $ThreadsPerShard"

New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ShardRoot -Force | Out-Null

$allCampaigns = @(
    [pscustomobject]@{ Name = "safety"; Contract = "LokSafetyInvariantTest" },
    [pscustomobject]@{ Name = "fairness"; Contract = "LokFairnessInvariantTest" }
)
$campaigns = if ($CampaignName -eq "all") {
    $allCampaigns
} else {
    @($allCampaigns | Where-Object { $_.Name -eq $CampaignName })
}

$runsPerShard = [int][math]::Ceiling($Sequences / [double]$ShardsPerCampaign)
$previousRuns = $env:FOUNDRY_INVARIANT_RUNS
$previousDepth = $env:FOUNDRY_INVARIANT_DEPTH
$previousFuzzRuns = $env:FOUNDRY_FUZZ_RUNS
$processes = @()
$reports = @()

try {
    $env:FOUNDRY_INVARIANT_RUNS = $runsPerShard.ToString()
    $env:FOUNDRY_INVARIANT_DEPTH = $Depth.ToString()
    $env:FOUNDRY_FUZZ_RUNS = $FuzzRuns.ToString()

    foreach ($campaign in $campaigns) {
        for ($shard = 0; $shard -lt $ShardsPerCampaign; ++$shard) {
            $seed = New-DeterministicInvariantSeed $campaign.Name $shard
            $baseName = "$($campaign.Name)-$($shard.ToString('D3'))"
            $stdoutPath = Join-Path $ShardRoot "$baseName.stdout.txt"
            $stderrPath = Join-Path $ShardRoot "$baseName.stderr.txt"
            $exitCodePath = Join-Path $ShardRoot "$baseName.exitcode.txt"
            $endedAtPath = Join-Path $ShardRoot "$baseName.ended-at.txt"
            $launchArtifactPath = Join-Path $ShardRoot "$baseName.launch.json"
            $shardArtifactPath = Join-Path $ShardRoot "$baseName.shard.json"
            foreach ($stalePath in @($stdoutPath, $stderrPath, $exitCodePath, $endedAtPath, $launchArtifactPath,
                    $shardArtifactPath)) {
                if (Test-Path -LiteralPath $stalePath -PathType Leaf) {
                    Remove-Item -LiteralPath $stalePath -Force
                }
            }

            $exactCommand = "FOUNDRY_INVARIANT_RUNS=$runsPerShard FOUNDRY_INVARIANT_DEPTH=$Depth FOUNDRY_FUZZ_RUNS=$FuzzRuns `"$Forge`" test --match-contract ^$($campaign.Contract)$ --match-test ^invariant_ --fuzz-seed $seed --threads $ThreadsPerShard -vv"
            $arguments = @(
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ShardRunner,
                "-Forge", $Forge, "-ProjectRoot", $ProjectRoot, "-Contract", $campaign.Contract,
                "-Seed", $seed, "-Threads", $ThreadsPerShard.ToString(), "-ExitCodePath", $exitCodePath,
                "-EndedAtPath", $endedAtPath
            )
            $process = $null
            $startedAtUtc = $null
            for ($launchAttempt = 1; $launchAttempt -le 5; ++$launchAttempt) {
                $startedAtUtc = [DateTime]::UtcNow
                $launchReport = [ordered]@{
                    schemaVersion = 2; campaign = $campaign.Name; contract = $campaign.Contract
                    shard = $shard; shardCount = $ShardsPerCampaign; seed = $seed; launchAttempt = $launchAttempt
                    gitCommit = $gitCommit; sourceStatusBeforeRun = $sourceStatusBeforeRun
                    exactCommand = $exactCommand; forgeVersion = $forgeVersion
                    solcVersion = $solcVersion; nodeVersion = $nodeVersion
                    startedAtUtc = $startedAtUtc.ToString("o")
                }
                [System.IO.File]::WriteAllText(
                    $launchArtifactPath,
                    ($launchReport | ConvertTo-Json -Depth 6) + [Environment]::NewLine
                )
                $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $ProjectRoot `
                    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
                if ($null -ne $process) { break }
                Start-Sleep -Seconds 2
            }
            if ($null -eq $process) {
                throw "Shard process failed to start after 5 attempts: $baseName."
            }
            $processes += [pscustomobject]@{
                Campaign = $campaign.Name; Contract = $campaign.Contract; Shard = $shard; Seed = $seed
                Process = $process; StdoutPath = $stdoutPath; StderrPath = $stderrPath
                ExitCodePath = $exitCodePath; EndedAtPath = $endedAtPath; LaunchArtifactPath = $launchArtifactPath
                ShardArtifactPath = $shardArtifactPath
                StartedAtUtc = $startedAtUtc; ExactCommand = $exactCommand
            }
            Start-Sleep -Milliseconds 100
        }
    }

    Write-Output "Started $($processes.Count) Forge shards: $ShardsPerCampaign per campaign, $runsPerShard sequences per shard."
    foreach ($entry in $processes) { $entry.Process.WaitForExit() }

    foreach ($campaign in $campaigns) {
        $campaignEntries = @($processes | Where-Object { $_.Campaign -eq $campaign.Name })
        $campaignSequences = [int64]0
        $campaignCalls = [int64]0
        $campaignReverts = [int64]0
        $campaignExitCode = 0
        $settleDrawCallCount = [int64]0
        $selectorCallCounts = @{}
        $shardReports = @()
        $combined = New-Object System.Text.StringBuilder
        $campaignStartedAtUtc = ($campaignEntries.StartedAtUtc | Sort-Object | Select-Object -First 1)
        $campaignEndedAtUtc = $campaignStartedAtUtc

        foreach ($entry in $campaignEntries) {
            if (-not (Test-Path -LiteralPath $entry.EndedAtPath -PathType Leaf)) {
                throw "missing shard end timestamp for $($campaign.Name) shard $($entry.Shard)."
            }
            $endedAtUtc = [DateTime]::Parse([System.IO.File]::ReadAllText($entry.EndedAtPath)).ToUniversalTime()
            if ($endedAtUtc -gt $campaignEndedAtUtc) { $campaignEndedAtUtc = $endedAtUtc }
            $stdout = [System.IO.File]::ReadAllText($entry.StdoutPath)
            $stderr = [System.IO.File]::ReadAllText($entry.StderrPath)
            $parsed = Read-ForgeInvariantOutput $stdout
            if (-not (Test-Path -LiteralPath $entry.ExitCodePath -PathType Leaf)) {
                throw "missing shard exit code for $($campaign.Name) shard $($entry.Shard)."
            }
            $shardExitCode = [int][System.IO.File]::ReadAllText($entry.ExitCodePath)
            $rawStdoutSha256 = Get-FileSha256 $entry.StdoutPath
            $rawStderrSha256 = Get-FileSha256 $entry.StderrPath
            $launchMetadataSha256 = Get-FileSha256 $entry.LaunchArtifactPath

            $campaignSequences += $parsed.sequences
            $campaignCalls += $parsed.calls
            $campaignReverts += $parsed.reverts
            $settleDrawCallCount += $parsed.settleDrawCallCount
            Add-SelectorCounts $selectorCallCounts $parsed.selectorCallCounts
            if ($shardExitCode -ne 0) { $campaignExitCode = $shardExitCode }

            $shardReport = [ordered]@{
                schemaVersion = 2; campaign = $campaign.Name; contract = $campaign.Contract
                shard = $entry.Shard; shardCount = $ShardsPerCampaign; seed = $entry.Seed
                gitCommit = $gitCommit; sourceStatusBeforeRun = $sourceStatusBeforeRun
                exactCommand = $entry.ExactCommand; forgeVersion = $forgeVersion
                solcVersion = $solcVersion; nodeVersion = $nodeVersion
                sequences = $parsed.sequences; depth = $Depth; calls = $parsed.calls; reverts = $parsed.reverts
                selectorCallCounts = $parsed.selectorCallCounts
                settleDrawCallCount = $parsed.settleDrawCallCount
                exitCode = $shardExitCode
                rawStdout = "artifacts/invariants/shards/$([System.IO.Path]::GetFileName($entry.StdoutPath))"
                rawStderr = "artifacts/invariants/shards/$([System.IO.Path]::GetFileName($entry.StderrPath))"
                launchMetadata = "artifacts/invariants/shards/$([System.IO.Path]::GetFileName($entry.LaunchArtifactPath))"
                rawStdoutSha256 = $rawStdoutSha256; rawStderrSha256 = $rawStderrSha256
                launchMetadataSha256 = $launchMetadataSha256
                startedAtUtc = $entry.StartedAtUtc.ToString("o"); endedAtUtc = $endedAtUtc.ToString("o")
            }
            [System.IO.File]::WriteAllText(
                $entry.ShardArtifactPath,
                ($shardReport | ConvertTo-Json -Depth 8) + [Environment]::NewLine
            )
            $shardReports += [pscustomobject]$shardReport
            [void]$combined.AppendLine("===== shard $($entry.Shard) seed $($entry.Seed) =====")
            [void]$combined.AppendLine($stdout)
            if ($stderr.Length -gt 0) { [void]$combined.AppendLine($stderr) }
        }

        $rawLogPath = Join-Path $ArtifactRoot "$($campaign.Name).raw.txt"
        [System.IO.File]::WriteAllText($rawLogPath, $combined.ToString())
        $rawLogSha256 = Get-FileSha256 $rawLogPath
        $settlementSelectorIncluded = $settleDrawCallCount -gt 0
        $passed = $campaignExitCode -eq 0 -and $campaignSequences -ge $Sequences -and `
            $campaignReverts -eq 0 -and $settlementSelectorIncluded
        $report = [ordered]@{
            abi = @(); schemaVersion = 2; campaign = $campaign.Name; contract = $campaign.Contract
            status = if ($passed) { "PASS" } else { "FAIL" }; targetSequences = $Sequences
            sequences = $campaignSequences; depth = $Depth; calls = $campaignCalls; reverts = $campaignReverts
            shards = $ShardsPerCampaign; runsPerShard = $runsPerShard
            selectorCallCounts = [pscustomobject]$selectorCallCounts
            settleDrawCallCount = $settleDrawCallCount
            settlementSelectorIncluded = $settlementSelectorIncluded
            shardResults = $shardReports
            gitCommit = $gitCommit; sourceStatusBeforeRun = $sourceStatusBeforeRun
            exactCommand = $topLevelExactCommand
            forgeVersion = $forgeVersion; solcVersion = $solcVersion; nodeVersion = $nodeVersion
            startedAtUtc = $campaignStartedAtUtc.ToString("o"); endedAtUtc = $campaignEndedAtUtc.ToString("o")
            durationSeconds = [math]::Round(($campaignEndedAtUtc - $campaignStartedAtUtc).TotalSeconds, 3)
            rawLog = "artifacts/invariants/$($campaign.Name).raw.txt"; rawLogSha256 = $rawLogSha256
            proofWorker = "codex-current-context-by-owner-exception"
            independentReview = "PENDING_INDEPENDENT_AUDIT"; exitCode = $campaignExitCode
        }
        $reportPath = Join-Path $ArtifactRoot "$($campaign.Name).json"
        [System.IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 12) + [Environment]::NewLine)
        $reports += [pscustomobject]$report
        if (-not $passed) { throw "Campaign $($campaign.Name) failed its evidence gate. See $reportPath" }
    }
}
finally {
    foreach ($entry in $processes) {
        if (-not $entry.Process.HasExited) { $entry.Process.Kill(); $entry.Process.WaitForExit() }
        $entry.Process.Dispose()
    }
    $env:FOUNDRY_INVARIANT_RUNS = $previousRuns
    $env:FOUNDRY_INVARIANT_DEPTH = $previousDepth
    $env:FOUNDRY_FUZZ_RUNS = $previousFuzzRuns
}

$summary = [ordered]@{
    abi = @(); schemaVersion = 2; status = "PASS"; requiredSequencesPerCampaign = $Sequences
    gitCommit = $gitCommit; sourceStatusBeforeRun = $sourceStatusBeforeRun
    exactCommand = $topLevelExactCommand
    campaigns = $reports; generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    independentReview = "PENDING_INDEPENDENT_AUDIT"
}
[System.IO.File]::WriteAllText(
    (Join-Path $ArtifactRoot "summary.json"),
    ($summary | ConvertTo-Json -Depth 14) + [Environment]::NewLine
)
$reports | Format-Table campaign, status, sequences, calls, settleDrawCallCount, shards, durationSeconds -AutoSize

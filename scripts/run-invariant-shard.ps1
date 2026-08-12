[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Forge,

    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $true)]
    [string]$Contract,

    [Parameter(Mandatory = $true)]
    [string]$Seed,

    [Parameter(Mandatory = $true)]
    [int]$Threads,

    [Parameter(Mandatory = $true)]
    [string]$ExitCodePath
)

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $ProjectRoot
& $Forge test --match-contract "^$Contract$" --match-test "^invariant_" --fuzz-seed $Seed --threads $Threads -vv
$code = $LASTEXITCODE
[System.IO.File]::WriteAllText($ExitCodePath, $code.ToString())
exit $code

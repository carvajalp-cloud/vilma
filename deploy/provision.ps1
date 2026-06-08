<#
.SYNOPSIS
  Provision the Vilma VM on Azure (resource group, networking, Ubuntu VM with Docker).

.DESCRIPTION
  Substitutes the registry/owner + compose file into cloud-init, base64-encodes it as VM
  customData, then deploys deploy/main.bicep into a resource group.

.EXAMPLE
  ./provision.ps1 -GitHubOwner myuser -ResourceGroup vilma-rg -Location eastus `
                  -SshPublicKeyPath $HOME\.ssh\vilma.pub -SshSourceAddress 203.0.113.5/32
#>
param(
  [Parameter(Mandatory = $true)] [string] $GitHubOwner,                 # GitHub user/org that owns the GHCR images
  [string] $ResourceGroup = 'vilma-rg',
  [string] $Location = 'eastus',
  [string] $VmName = 'vilma',
  [string] $VmSize = 'Standard_B2s',
  [string] $AdminUsername = 'azureuser',
  [Parameter(Mandatory = $true)] [string] $SshPublicKeyPath,            # e.g. $HOME\.ssh\vilma.pub
  [string] $SshSourceAddress = '*',                                     # lock to your IP, e.g. 203.0.113.5/32
  [string] $SyslogSourceAddress = '*'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $here

# --- sanity checks ---
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI (az) not found. Install: https://aka.ms/installazurecliwindows"
}
if (-not (Test-Path $SshPublicKeyPath)) {
  throw "SSH public key not found at $SshPublicKeyPath. Create one: ssh-keygen -t ed25519 -f `$HOME\.ssh\vilma"
}
$composePath = Join-Path $repoRoot 'docker-compose.prod.yml'
$cloudInitPath = Join-Path $here 'cloud-init.yaml'
$bicepPath = Join-Path $here 'main.bicep'
foreach ($p in @($composePath, $cloudInitPath, $bicepPath)) {
  if (-not (Test-Path $p)) { throw "Missing required file: $p" }
}

$registry = "ghcr.io/$($GitHubOwner.ToLower())"
$sshKey = (Get-Content $SshPublicKeyPath -Raw).Trim()

# --- build cloud-init: inject compose (b64), registry, admin user; then base64 the whole thing ---
Write-Host "Building cloud-init (registry: $registry)..." -ForegroundColor Cyan
$composeText = Get-Content $composePath -Raw
$composeB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($composeText))

$cloudInit = Get-Content $cloudInitPath -Raw
$cloudInit = $cloudInit.Replace('__COMPOSE_B64__', $composeB64)
$cloudInit = $cloudInit.Replace('__REGISTRY__', $registry)
$cloudInit = $cloudInit.Replace('__ADMIN_USER__', $AdminUsername)
$customData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cloudInit))

# --- deploy ---
Write-Host "Creating resource group '$ResourceGroup' in $Location..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location --output none

Write-Host "Deploying VM and networking (this takes a few minutes)..." -ForegroundColor Cyan
$deployName = "vilma-deploy"
az deployment group create `
  --resource-group $ResourceGroup `
  --name $deployName `
  --template-file $bicepPath `
  --parameters `
    location=$Location `
    vmName=$VmName `
    vmSize=$VmSize `
    adminUsername=$AdminUsername `
    sshPublicKey="$sshKey" `
    customData="$customData" `
    sshSourceAddress="$SshSourceAddress" `
    syslogSourceAddress="$SyslogSourceAddress" `
  --output none

# --- show outputs ---
$out = az deployment group show --resource-group $ResourceGroup --name $deployName --query properties.outputs --output json | ConvertFrom-Json
Write-Host "`n=== Provisioning complete ===" -ForegroundColor Green
Write-Host ("Public IP : {0}" -f $out.publicIp.value)
Write-Host ("FQDN      : {0}" -f $out.fqdn.value)
Write-Host ("App URL   : {0}" -f $out.appUrl.value)
Write-Host ("SSH       : {0}" -f $out.sshCommand.value)
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Add these GitHub repo secrets:"
Write-Host ("       AZURE_VM_HOST    = {0}" -f $out.publicIp.value)
Write-Host ("       AZURE_VM_USER    = {0}" -f $AdminUsername)
Write-Host  "       AZURE_VM_SSH_KEY = <contents of your PRIVATE key file>"
Write-Host "  2. Push to main (or run the 'Deploy Vilma' workflow) to build images and deploy."
Write-Host "  3. One-time seed (optional demo data): see DEPLOY.md."
